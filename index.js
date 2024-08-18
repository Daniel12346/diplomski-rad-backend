import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import { getJson } from "serpapi";
import dotenv from "dotenv";
import fileupload from "express-fileupload";

dotenv.config();
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(fileupload({ useTempFiles: true }));
app.use(cors());

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

app.post("/find-related", async (req, res) => {
  const imagePath = req.body.imageSrc;
  if (!imagePath) {
    return new Error("Image URL not provided");
  }
  const response = await getJson("google_reverse_image", {
    api_key: process.env.SERPAPI_KEY,
    image_url: imagePath,
  });
  res.json(response);
});
//--------------------

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
    res.json({ message: "Data saved successfully" });
  } catch (err) {
    res.json({ message: "Data could not be saved" });
    console.log(err);
  }
});

app.get("/result-history", async (req, res) => {
  const imageCheckResults = await ImageCheckResultModel.find().sort({
    createdAt: -1,
  });
  res.json({ results: imageCheckResults });
});

app.get("/validity-stats", async (req, res) => {
  const totalImages = await ImageCheckResultModel.countDocuments();
  const realImages = await ImageCheckResultModel.countDocuments({
    result: "REAL",
  });
  const fakeImages = await ImageCheckResultModel.countDocuments({
    result: "FAKE",
  });
  const unknownImages = await ImageCheckResultModel.countDocuments({
    result: "UNKNOWN",
  });
  res.json({ totalImages, realImages, fakeImages, unknownImages });
});

app.get("/social-media-stats", async (req, res) => {
  const socialMediaStats = await ImageCheckResultModel.aggregate([
    {
      $group: {
        _id: "$socialMediaName",
        count: { $sum: 1 },
      },
    },
  ]);
  res.json(socialMediaStats);
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
