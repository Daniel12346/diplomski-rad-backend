import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import { getJson } from "serpapi";
import dotenv from "dotenv";
import fileupload from "express-fileupload";
import { v2 } from "cloudinary";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(fileupload({ useTempFiles: true }));
app.use(cors());

v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const imageCheckResultSchema = new mongoose.Schema(
  {
    imageUrl: {
      type: String,
      required: true,
    },
    socialMediaName: {
      type: String,
      required: true,
    },
    result: {
      // REAL, FAKE, UNKNOWN
      type: String,
    },
    confidence: {
      type: Number,
      nullable: true,
    },
  },
  //adds createdAt and updatedAt fields
  { timestamps: true }
);

const ImageCheckResultModel = mongoose.model(
  "ImageCheckResult",
  imageCheckResultSchema
);

app.post("/upload-image", async (req, res) => {
  const { imagePath } = req.body;
  const path = imagePath;
  if (!path) {
    return res.status(400).json({ message: "Image path not provided" });
  }
  try {
    const cloudinaryResponse = await v2.uploader.upload(path);
    console.log(cloudinaryResponse);
    res.status(200).json(cloudinaryResponse);
  } catch (err) {
    console.log(err);
    //send error message
    res.status(500).json({ message: "Error uploading image" });
  }
});

app.post("/find-related", async (req, res) => {
  const imagePath = req.body.imageSrc;
  if (!imagePath) {
    res.status(400).json({ message: "Image path not provided" });
  }
  const response = await getJson("google_reverse_image", {
    api_key: process.env.SERPAPI_KEY,
    image_url: imagePath,
  });
  res.status(200).json(response);
});

app.post("/save-result-data", async (req, res) => {
  const { imageUrl, socialMediaName, result, confidence } = req.body;
  const newImageCheckResult = new ImageCheckResultModel({
    imageUrl,
    socialMediaName,
    result,
    confidence,
  });
  try {
    await newImageCheckResult.save();
    res.send(201).json({ message: "Data saved successfully" });
  } catch (err) {
    console.log(err);
    res.send(500).json({ message: "Data could not be saved" });
  }
});

app.get("/result-history", async (req, res) => {
  try {
    const imageCheckResults = await ImageCheckResultModel.find().sort({
      createdAt: -1,
    });
    res.json({ results: imageCheckResults });
  } catch (err) {
    res.status(500).json({ message: "Error fetching history data" });
  }
});

app.get("/validity-stats", async (req, res) => {
  try {
    const [totalImages, realImages, fakeImages, unknownImages] =
      await Promise.all([
        ImageCheckResultModel.countDocuments(),
        ImageCheckResultModel.countDocuments({ result: "REAL" }),
        ImageCheckResultModel.countDocuments({ result: "FAKE" }),
        ImageCheckResultModel.countDocuments({ result: "UNKNOWN" }),
      ]);
    res
      .status(200)
      .json({ totalImages, realImages, fakeImages, unknownImages });
  } catch (err) {
    res.status(500).json({ message: "Error fetching validity stats" });
  }
});

app.get("/social-media-stats", async (req, res) => {
  try {
    const socialMediaStats = await ImageCheckResultModel.aggregate([
      {
        $group: {
          _id: "$socialMediaName",
          count: { $sum: 1 },
        },
      },
    ]);
    res.status(200).json(socialMediaStats);
  } catch (err) {
    res.status(500).json({ message: "Error fetching social media stats" });
  }
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    app.listen(process.env.PORT || 5000);
    console.log("DB connected and server is running.");
  })
  .catch((err) => {
    console.log(err);
  });
