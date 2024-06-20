const express = require("express");
const faceapi = require("face-api.js");
const mongoose = require("mongoose");
const canvas = require("canvas");
const cors = require("cors");
const { getJson } = require("serpapi");
const { url } = require("inspector");
require("dotenv").config();
const { Canvas, Image } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image });

const app = express();

app.use(express.json());
app.use(cors());

async function LoadModels() {
  // Load the models
  // __dirname gives the root directory of the server
  await faceapi.nets.faceRecognitionNet.loadFromDisk(__dirname + "/models");
  await faceapi.nets.faceLandmark68Net.loadFromDisk(__dirname + "/models");
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(__dirname + "/models");
}
LoadModels();

const faceSchema = new mongoose.Schema({
  label: {
    type: String,
    required: true,
    unique: true,
  },
  descriptions: {
    type: Array,
    required: true,
  },
});

const FaceModel = mongoose.model("Face", faceSchema);

const imageCheckResultSchema = new mongoose.Schema({
  imageUrl: {
    type: String,
    required: true,
  },
  socialMediaName: {
    type: String,
    required: true,
  },
  recognizedFace: {
    type: String,
    required: true,
  },
  result: {
    // REAL, FAKE, UNKNOWN
    type: String,
  },
});

const ImageCheckResultModel = mongoose.model(
  "ImageCheckResult",
  imageCheckResultSchema
);

async function uploadLabeledImages(images, label) {
  try {
    let counter = 0;
    const descriptions = [];
    // Loop through the images
    for (let i = 0; i < images.length; i++) {
      const img = await canvas.loadImage(images[i]);
      counter = (i / images.length) * 100;
      console.log(`Progress = ${counter}%`);
      // Read each face and save the face descriptions in the descriptions array
      const detections = await faceapi
        .detectSingleFace(img)
        .withFaceLandmarks()
        .withFaceDescriptor();

      console.log(detections);
      detections?.descriptor && descriptions.push(detections.descriptor);
    }

    // Create a new face document with the given label and save it in DB
    const createFace = new FaceModel({
      label: label,
      descriptions: descriptions,
    });
    await createFace.save();
    return true;
  } catch (error) {
    console.log(error);
    return error;
  }
}

async function getDescriptorsFromDB(image) {
  // Get all the face data from mongodb and loop through each of them to read the data
  let faces = await FaceModel.find();
  for (i = 0; i < faces.length; i++) {
    // Change the face data descriptors from Objects to Float32Array type
    for (j = 0; j < faces[i].descriptions.length; j++) {
      faces[i].descriptions[j] = new Float32Array(
        Object.values(faces[i].descriptions[j])
      );
    }
    // Turn the DB face docs to
    faces[i] = new faceapi.LabeledFaceDescriptors(
      faces[i].label,
      faces[i].descriptions
    );
  }

  // Load face matcher to find the matching face
  const faceMatcher = new faceapi.FaceMatcher(faces, 0.6);

  // Read the image using canvas or other method
  const img = await canvas.loadImage(image);
  let temp = faceapi.createCanvasFromMedia(img);
  // Process the image for the model
  const displaySize = { width: img.width, height: img.height };
  faceapi.matchDimensions(temp, displaySize);

  // Find matching faces
  const detections = await faceapi
    .detectAllFaces(img)
    .withFaceLandmarks()
    .withFaceDescriptors();
  const resizedDetections = faceapi.resizeResults(detections, displaySize);
  faceapi.draw.drawDetections(temp, resizedDetections);
  const results = resizedDetections.map((d) =>
    faceMatcher.findBestMatch(d.descriptor)
  );
  return { matchResults: results, resizedDetections, canvas: temp };
}

app.post("/post-face", async (req, res) => {
  const File1 = req.files.File1.tempFilePath;
  const File2 = req.files.File2.tempFilePath;
  const File3 = req.files.File3.tempFilePath;
  const label = req.body.label;
  let result = await uploadLabeledImages([File1, File2, File3], label);
  if (result) {
    res.json({ message: "Face data stored successfully" });
  } else {
    res.json({ message: "Something went wrong, please try again." });
  }
});

app.post("/check-face", async (req, res) => {
  const imagePath = req.body.imageSrc;
  console.log(imagePath);
  if (!imagePath) {
    return new Error("Image URL not provided");
  }
  let { matchResults, resizedDetections, canvas } = await getDescriptorsFromDB(
    imagePath
  );
  console.log(matchResults);
  res.json({
    matchResults,
    resizedDetections,
    boundingBoxOverlaySrc: canvas.toDataURL(),
  });
});

app.post("/find-related", async (req, res) => {
  const imagePath = req.body.imageSrc;
  if (!imagePath) {
    return new Error("Image URL not provided");
  }
  const response = await getJson("google_reverse_image", {
    api_key: process.env.SERPAPI_KEY,
    image_url: imagePath,
  });
  console.log(response);
  res.json(response);
});

app.post("/save-result-data", async (req, res) => {
  const { imageUrl, socialMediaName, recognizedFace, result } = req.body;
  const newImageCheckResult = new ImageCheckResultModel({
    imageUrl,
    socialMediaName,
    recognizedFace,
    result,
  });
  await newImageCheckResult.save();
  res.json({ message: "Data saved successfully" });
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
    console.log("DB connected and server us running.");
  })
  .catch((err) => {
    console.log(err);
  });
