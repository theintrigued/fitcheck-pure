const express = require("express");
const User = require("../models/user");
const router = express.Router();
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { Readable } = require("stream");
const sharp = require("sharp");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const multer = require("multer");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");

const { v4: uuidv4 } = require("uuid");
const path = require("path");
const bodyParser = require("body-parser");

// ------- mongo db connection --------
mongoose.connect("mongodb://localhost:27018/fitcheckDB");
const database = mongoose.connection; //get the database object from mongoose connection

database.on("error", (error) => {
  console.log(error);
});

database.once("connected", () => {
  console.log("Database Connected: " + database.name);
});

// ------- mongo db connection --------

// Create storage for multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./uploads");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + uuidv4();
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

router.post("/getfile", (req, res) => {
  const filePath = path.join(__dirname, "../uploads", req.body.filename);

  res.sendFile(filePath);
});

// create GridFS instance
const { GridFSBucket } = require("mongodb");
let bucket;
database.once("open", () => {
  bucket = new GridFSBucket(database.db, {
    bucketName: "uploads",
  });
  console.log("GridFS Connected");
});

//generate unique file name
async function generateUniqueFilename(username, bucket) {
  let isUnique = false;
  let filename;
  while (!isUnique) {
    // Generate a random number and append it to the username
    const randomNumber = Math.floor(Math.random() * 1000000);
    filename = `${username}_${randomNumber}`;

    // Check if the filename is unique in the GridFS bucket collection
    const file = await bucket.find({ filename }).toArray();
    if (file.length === 0) {
      isUnique = true;
    }
  }
  return filename;
}

//compress image
async function compressImage(base64Image) {
  const buffer = Buffer.from(base64Image, "base64");
  const resizedImageBuffer = await sharp(buffer)
    .resize({ width: 1200, height: null })
    .jpeg({ quality: 80 })
    .toBuffer();
  return resizedImageBuffer.toString("base64");
}

//handle Register
router.post("/register", async (req, res) => {
  User.findOne({ email: req.body.email }).then(async (result) => {
    if (!result) {
      const newUser = new User({
        fullname: req.body.fullname,
        username: req.body.username,
        phonenumber: req.body.phonenumber,
        email: req.body.email,
        fitcheck: [],
        password: req.body.password,
        images: [],
        bio: "",
        followers: [],
        following: [],
      });

      try {
        const dataToSave = await newUser.save();
        res.status(200).json(dataToSave);
      } catch (error) {
        res.status(400).json({ message: error.message });
      }
    } else {
      res.status(400).json({ message: "User already exists!" });
    }
  });
});

//Handle Login
router.post("/login", async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  try {
    const user = await User.findOne({ username, password });
    if (!user) {
      res.status(400).json({ message: "Username or password is incorrect" });
      return;
    }

    res.status(200).json({ user: user });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error while logging in" });
  }
});

//UPLOAD FITCHECK
//SET Fitcheck and its video
const upload = multer({ storage: storage });
router.post("/uploadfitcheck", upload.single("video"), async (req, res) => {
  try {
    const file = req.file;

    const videoPath = path.join(__dirname, "../uploads", file.filename);
    const outputPostername = file.filename.replace(".mp4", "_1.jpg");
    const outputPath = path.join(__dirname, "../uploads");

    const outputVideoPath = path.join(
      outputPath,
      "compressed_" + file.filename.replace(".mp4", ".mov") // set the output format to .mov
    );
    const outputThumbnailPath = path.join(outputPath, outputPostername);

    // Set the video and audio bitrates
    const command = ffmpeg(videoPath)
      .videoBitrate("2000k")
      .audioBitrate("128k")
      .output(outputVideoPath)
      .on("end", async () => {
        console.log("Compressed video saved to " + outputVideoPath);

        // Extract a thumbnail image
        await new Promise((resolve, reject) => {
          ffmpeg(outputVideoPath)
            .screenshots({
              count: 1,
              timemarks: ["1"],
              folder: outputPath,
              filename: outputPostername,
            })
            .on("end", () => {
              console.log("Thumbnail saved to " + outputThumbnailPath);
              resolve();
            })
            .on("error", (error) => {
              reject(error);
            });
        });

        // Update the user object with the new fitcheck
        const updatedUser = await User.findOneAndUpdate(
          { username: req.body.username },
          {
            $push: {
              fitcheck: {
                likes: [],
                caption: req.body.caption,
                comments: [],
                listings: [],
                video: {
                  filename:
                    "compressed_" + file.filename.replace(".mp4", ".mov"), // set the output format to .mov
                  contentType: "video/mov",
                  uploadDate: Date.now(),
                  caption: req.body.caption,
                  size: file.size,
                  postername: outputPostername,
                },
              },
            },
          },
          { new: true }
        );

        const fitcheckObject =
          updatedUser.fitcheck[updatedUser.fitcheck.length - 1];

        res.send({ message: "Video uploaded successfully!" });
      })
      .on("error", (err) => {
        console.error(err);
        res.status(500).send({ message: "Error uploading video" });
      })
      .run();
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Error uploading video" });
  }
});

// GET A Fitcheck
router.post("/getfitcheckdata", async (req, res) => {
  try {
    const username = req.body.username;
    const fitcheckId = req.body.fitcheckId;
    console.log(username + fitcheckId);
    const user = await User.findOne({ username: username });
    const fitcheck = await user.fitcheck.find(
      (fitcheck) => fitcheck._id == fitcheckId
    );

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    if (!fitcheck) {
      res.status(404).json({ message: "Fitcheck not found" });
      return;
    }

    // Check if video exists
    if (!fitcheck.video.filename) {
      return res.status(404).send({ message: "Video not found" });
    }

    // Set the headers for the video response
    const videoPath = `./uploads/${fitcheck.video.filename}`;
    const videoStat = fs.statSync(videoPath);
    const videoSize = videoStat.size;
    const range = req.headers.range;
    const videoType = fitcheck.video.contentType;

    // Handle iOS devices by returning the full video file
    if (
      req.headers["user-agent"].includes("iPhone") ||
      req.headers["user-agent"].includes("iPad")
    ) {
      res.header("Content-Type", videoType);
      res.sendFile(videoPath);
      return;
    }

    // Handle other devices by streaming the video
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : videoSize - 1;
      const chunksize = end - start + 1;
      const video = fs.createReadStream(videoPath, { start, end });
      const head = {
        "Content-Range": `bytes ${start}-${end}/${videoSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": videoType,
      };
      res.writeHead(206, head);
      video.pipe(res);
    } else {
      const head = {
        "Content-Length": videoSize,
        "Content-Type": videoType,
      };
      const video = fs.createReadStream(videoPath);
      const fitcheckToSend = {
        id: fitcheck._id,
        caption: fitcheck.caption,
        likes: fitcheck.likes,
        comments: fitcheck.comments,
        video: {
          file: video,
          filename: fitcheck.video.filename,
          postername: fitcheck.video.postername,
        },
      };

      res.status(200).json({ fitcheck: fitcheckToSend });
      //fs.createReadStream(path).pipe(res);
    }
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Error retrieving video" });
  }
});

//SET A new Listing (of a Fitcheck)
router.post("/uploadnewlisting", async (req, res) => {
  const username = req.body.username;
  const fitcheckId = req.body.fitcheckId;

  try {
    // Find the user by their username
    const user = await User.findOne({ username });
    if (!user) {
      throw new Error("User not found");
    }

    // Find the index of the fitcheck in the user's fitcheck array
    const fitcheckIndex = user.fitcheck.findIndex(
      (f) => f._id.toString() === fitcheckId
    );
    if (fitcheckIndex === -1) {
      throw new Error("Fitcheck not found");
    }

    // Create a new listing object using the provided listing data
    const newListing = {
      name: req.body.name,
      dolapurl: req.body.dolapurl,
      description: req.body.description,
      category: req.body.category,
      size: req.body.size,
      brand: req.body.brand,
      condition: req.body.condition,
      packagesize: req.body.packagesize,
      price: req.body.price,
      images: [],
    };

    // Add the new listing to the fitcheck's listings array and save the user
    user.fitcheck[fitcheckIndex].listings.push(newListing);
    await user.save();

    // Get the ID of the newly added listing by finding the last element of the fitcheck's listings array
    const newListingId =
      user.fitcheck[fitcheckIndex].listings[
        user.fitcheck[fitcheckIndex].listings.length - 1
      ]._id.toString();

    //Make the new image ready for saving
    const compressedImage = await compressImage(req.body.image);
    // decode the base64-encoded image data to a buffer
    const buffer = Buffer.from(compressedImage, "base64");

    const uniqueFilename = await generateUniqueFilename(
      req.body.username,
      bucket
    );
    // upload the buffer to GridFS
    const uploadStream = bucket.openUploadStream(uniqueFilename);
    const readStream = new Readable();
    readStream.push(buffer);
    readStream.push(null);
    readStream.pipe(uploadStream);

    // save the file metadata to the images array of the listing object
    const fileID = uploadStream.id.toString();
    const fileData = {
      _id: fileID,
      filename: uniqueFilename,
      contentType: "image/jpeg",
    };

    // Find the user by username and update the listing
    const userWithEmptyListing = await User.findOne({
      username: username,
      "fitcheck._id": fitcheckId,
      "fitcheck.listings._id": newListingId,
    });

    if (!userWithEmptyListing) {
      throw new Error("User not found");
    }

    const listing = user.fitcheck
      .find((fitcheck) => fitcheck._id.equals(fitcheckId))
      .listings.find((listing) => listing._id.equals(newListingId));

    if (!listing) {
      throw new Error("Listing not found");
    }

    listing.images.push(fileData);

    const updatedUser = await user.save();

    // Return the newly added listing ID
    res.status(200).json({
      message: "Success",
      fitcheckId: fitcheckId,
      listingId: newListingId,
      listing: listing,
    });
  } catch (error) {
    res.status(400).json({ message: "There was error in the request." });
  }
});

//SET A new IMAGE (of a listing -> of a Fitcheck)
router.post("/uploadnewlistingimage", async (req, res) => {
  const username = req.body.username;
  const fitcheckId = req.body.fitcheckId;
  const listingId = req.body.listingId;
  const recievedImage = req.body.image;

  // Find the user by their username
  const user = await User.findOne({ username });
  if (!user) {
    return res.status(500).json({ message: "User Not Found" });
  }

  // Find the index of the fitcheck in the user's fitcheck array
  const fitcheckIndex = user.fitcheck.findIndex(
    (f) => f._id.toString() === fitcheckId
  );
  if (fitcheckIndex === -1) {
    return res.status(500).json({ message: "Fitcheck Not Found" });
  }

  //Make the new image ready for saving
  const compressedImage = await compressImage(recievedImage);
  // decode the base64-encoded image data to a buffer
  const buffer = Buffer.from(compressedImage, "base64");

  const uniqueFilename = await generateUniqueFilename(
    req.body.username,
    bucket
  );
  // upload the buffer to GridFS
  const uploadStream = bucket.openUploadStream(uniqueFilename);
  const readStream = new Readable();
  readStream.push(buffer);
  readStream.push(null);
  readStream.pipe(uploadStream);

  // save the file metadata to the images array of the listing object
  const fileID = uploadStream.id.toString();
  const fileData = {
    _id: fileID,
    filename: uniqueFilename,
    contentType: "image/jpeg",
  };

  const listing = user.fitcheck
    .find((fitcheck) => fitcheck._id.equals(fitcheckId))
    .listings.find((listing) => listing._id.equals(listingId));

  if (!listing) {
    return res.status(500).json({ message: "Listing Not Found" });
  }

  listing.images.push(fileData);

  const updatedUser = await user.save();

  // Return the newly added listing ID
  res.status(200).json({
    message: "Success",
    fitcheckId: fitcheckId,
    listingId: listingId,
    listing: listing,
  });
});

// GET All Listing Data (of a fitcheck)
router.post("/getallListingdata", async (req, res) => {
  try {
    const username = req.body.username;
    const fitcheckId = req.body.fitcheckId;

    const user = await User.findOne({ username: username });
    const fitcheck = user.fitcheck.find(
      (fitcheck) => fitcheck._id == fitcheckId
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!fitcheck) {
      return res.status(404).json({ message: "Fitcheck not found" });
    }

    const listings = fitcheck.listings;
    const organizedListings = [];

    for (const listing of listings) {
      const filenames = listing.images.map((eachImage) => eachImage.filename);
      const images = [];

      for (const filename of filenames) {
        const file = await bucket.find({ filename }).toArray();

        if (file.length === 0) {
          return res
            .status(404)
            .json({ message: `File ${filename} not found` });
        }

        const stream = bucket.openDownloadStreamByName(filename);
        const chunks = [];

        await new Promise((resolve, reject) => {
          stream.on("data", (chunk) => {
            chunks.push(chunk);
          });

          stream.on("error", (error) => {
            reject(error);
          });

          stream.on("end", () => {
            const buffer = Buffer.concat(chunks);
            const imageData = {
              filename,
              contentType: file[0].contentType,
              data: buffer.toString("base64"),
            };
            images.push(imageData);
            console.log(images);
            resolve();
          });
        });
      }

      const readyListingObject = {
        name: listing.name,
        dolapurl: listing.dolapurl,
        description: listing.description,
        category: listing.category,
        size: listing.size,
        brand: listing.brand,
        condition: listing.condition,
        packagesize: listing.packagesize,
        price: listing.price,
        id: listing._id,
        images: images,
      };
      organizedListings.push(readyListingObject);
    }

    res.status(200).json(organizedListings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET a Single Listing
router.post("/getlistingdata", async (req, res) => {
  const username = req.body.username;
  const fitcheckId = req.body.fitcheckId;
  const listingId = req.body.listingId;

  try {
    const user = await User.findOne({ username });
    if (!user) {
      throw new Error("User not found");
    }

    const fitcheck = user.fitcheck.find(
      (fitcheck) => fitcheck._id == fitcheckId
    );
    if (!fitcheck) {
      throw new Error("Fitcheck not found");
    }

    const listing = fitcheck.listings.find(
      (listing) => listing._id == listingId
    );
    if (!listing) {
      throw new Error("Listing not found");
    }

    const filenames = listing.images.map((image) => image.filename);
    const imagesWithData = [];

    const promises = filenames.map(async (filename) => {
      const file = await bucket.find({ filename });

      const stream = bucket.openDownloadStreamByName(filename);
      const chunks = [];

      stream.on("data", (chunk) => {
        chunks.push(chunk);
      });

      return new Promise((resolve, reject) => {
        stream.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const imageData = {
            filename,
            contentType: file.contentType,
            data: buffer.toString("base64"),
          };

          imagesWithData.push(imageData);
          resolve();
        });

        stream.on("error", (err) => {
          reject(err);
        });
      });
    });

    await Promise.all(promises);

    const listingToSend = {
      name: listing.name,
      dolapurl: listing.dolapurl,
      description: listing.description,
      category: listing.category,
      size: listing.size,
      brand: listing.brand,
      condition: listing.condition,
      packagesize: listing.packagesize,
      price: listing.price,
      id: listing._id,
      images: imagesWithData,
    };
    res.status(200).json({ listing: listingToSend });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error getting Listing" });
  }
});

// GET request handler for getting images by filenames
// GET request handler for getting images by filenames
router.post("/getallfitcheckdata", async (req, res) => {
  try {
    const username = req.body.username;
    const user = await User.findOne({ username: username });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    const fitchecks = user.fitcheck;
    const filenames = fitchecks.map((fitcheck) => fitcheck.video.filename);
    const posternames = fitchecks.map((fitcheck) => fitcheck.video.postername);
    const likes = fitchecks.map((fitcheck) => fitcheck.likes);
    const ids = fitchecks.map((fitcheck) => fitcheck._id);
    const captions = fitchecks.map((fitcheck) => fitcheck.caption);

    const allFitchecks = [];

    for (let i = 0; i < filenames.length; i++) {
      // Read video from disk
      const path = `./uploads/${filenames[i]}`;
      const filename = filenames[i];
      const stat = fs.statSync(path);
      const fileSize = stat.size;
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const file = fs.createReadStream(path, { start, end });
        const head = {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": fitchecks[i].video.contentType,
        };
        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          "Content-Length": fileSize,
          "Content-Type": fitchecks[i].video.contentType,
        };
        //res.writeHead(200, head);
        const file = fs.createReadStream(path);
        const fitcheckToSend = {
          id: ids[i],
          caption: captions[i],
          likes: likes[i],
          video: { file: file, filename: filename, postername: posternames[i] },
        };
        allFitchecks.push(fitcheckToSend);
      }
    }
    res.status(200).json(allFitchecks);
  } catch (error) {
    res.status(500).json({ message: "Error getting Fitchecks" });
  }
});

async function getAllUsersAndListings() {
  const users = await User.find();
  //const listingImages = [];
  const userAndFitchecks = [];

  for (const user of users) {
    console.log("Username: " + user.username);
    const fitchecks = [];
    for (const fitcheck of user.fitcheck) {
      console.log("Fitcheck: " + fitcheck._id);
      const listings = [];
      for (const listing of fitcheck.listings) {
        console.log("Listing: " + listing._id);
        const listingImages = [];
        for (const image of listing.images) {
          console.log("Image: " + image.filename);
          const filename = image.filename;
          const file = await bucket.find({ filename });
          const chunks = [];

          // read file data in chunks
          const stream = bucket.openDownloadStreamByName(filename);
          await new Promise((resolve, reject) => {
            stream.on("data", (chunk) => {
              chunks.push(chunk);
            });
            stream.on("end", async () => {
              // combine chunks into single buffer
              const buffer = Buffer.concat(chunks);

              // update fitcheck's video object to contain only data
              listingImages.push({
                username: user.username,
                fitcheckId: fitcheck._id,
                listingId: listing._id,
                data: buffer.toString("base64"),
              });
              resolve();
            });
            stream.on("error", reject);
          });
        }
        listings.push({
          listingId: listing._id,
          images: listingImages,
        });
      }
      fitchecks.push({
        fitcheckId: fitcheck._id,
        listings: listings,
      });
    }
    userAndFitchecks.push({
      username: user.username,
      fitchecks: fitchecks,
    });
  }
  return userAndFitchecks;
}

//GET All Users and their lisiting images
router.post("/getallusersandlistings", async (req, res) => {
  console.log("REQ RECIEVED");

  const listingsAndUsernames = await getAllUsersAndListings();
  console.log("FUNCTION COMPLETEE");

  res.status(200).json(listingsAndUsernames);
});

async function getAllUsersAndFitchecks() {
  const users = await User.find();
  const fitcheckVideosAndUsernames = [];

  for (const user of users) {
    for (const fitcheck of user.fitcheck) {
      const filename = fitcheck.video.filename;
      fitcheckVideosAndUsernames.push({
        id: fitcheck._id,
        username: user.username,
        caption: fitcheck.caption,
        likes: fitcheck.likes,
        video: fitcheck.video.filename,
      });
    }
  }

  return fitcheckVideosAndUsernames;
}

//GET All Users and their fitcheck videos
router.post("/getallusersandfitchecks", async (req, res) => {
  const fitcheckVideosAndUsernames = await getAllUsersAndFitchecks();

  res.status(200).json(fitcheckVideosAndUsernames);
});

//Add Followers
router.post("/addfollower", async (req, res) => {
  try {
    const username = req.body.username;
    const user = await User.findOne({ username: username });
    const followerUsername = req.body.follower;

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (user.followers.includes(followerUsername)) {
      res.status(400).json({ message: "This follower already exists" });
      return;
    }

    user.followers.push(followerUsername);
    await user.save();

    res.status(200).json({ message: "Success: Follower Added" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error Adding Follower" });
  }
});

//Modify Likes (of a fitcheck)
router.post("/modifyLikes", async (req, res) => {
  try {
    const username = req.body.username;
    const fitcheckId = req.body.fitcheckId;
    const user = await User.findOne({ "fitcheck._id": fitcheckId });
    const fitcheck = user.fitcheck.find(
      (fitcheck) => fitcheck._id == fitcheckId
    );

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    if (!fitcheck) {
      res.status(404).json({ message: "Fitcheck not found" });
      return;
    }

    const likes = fitcheck.likes; //this is the array all usernames that have liked this fitcheck

    if (likes.includes(username)) {
      // remove username from likes array
      fitcheck.likes = likes.filter(
        (likedUsername) => likedUsername !== username
      );
    } else {
      // add username to likes array
      fitcheck.likes.push(username);
    }

    await user.save();

    res.status(200).json({ message: "Success", likes: fitcheck.likes });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error });
  }
});

//GET Likes
router.post("/getLikes", async (req, res) => {
  try {
    const fitcheckId = req.body.fitcheckId;

    const user = await User.findOne({ "fitcheck._id": fitcheckId });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const fitcheck = await user.fitcheck.find(
      (fitcheck) => fitcheck._id == fitcheckId
    );

    if (!fitcheck) {
      res.status(404).json({ message: "Fitcheck not found" });
      return;
    }
    const likes = fitcheck.likes;
    res.status(200).json({ message: "Success", likes: likes });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error });
  }
});

//Add Following
router.post("/modifyfollowing", async (req, res) => {
  try {
    const username = req.body.username;
    const user = await User.findOne({ username: username });
    const followingPersonsUsername = req.body.following;

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (
      !followingPersonsUsername ||
      typeof followingPersonsUsername !== "string"
    ) {
      res.status(400).json({ message: "Invalid following person username" });
      return;
    }

    const followingPerson = await User.findOne({
      username: followingPersonsUsername,
    });

    if (!followingPerson) {
      res.status(404).json({ message: "Following User not found" });
      return;
    }

    const userIndex = followingPerson.followers.indexOf(username);
    const followingPersonIndex = user.following.indexOf(
      followingPersonsUsername
    );

    if (userIndex !== -1 && followingPersonIndex !== -1) {
      followingPerson.followers.splice(userIndex, 1);
      user.following.splice(followingPersonIndex, 1);
    } else {
      followingPerson.followers.push(username);
      user.following.push(followingPersonsUsername);
    }

    await user.save();
    await followingPerson.save();

    res.status(200).json({ message: "Success: Following Person Updated" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error Updating Following Person" });
  }
});

//Get a single user using their username
router.post("/getuser", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.body.username });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ user: user });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error getting user" });
  }
});

// GET All Matching Search Params
router.post("/search", async (req, res) => {
  let searchParams = req.body.params;
  const currentusername = req.body.username;

  if (!searchParams || Object.keys(searchParams).length === 0) {
    searchParams = "";
    console.log("SEARCH PARAM EMPTY");
    return res.status(200).json([]);
  }

  try {
    const results = await User.find({
      $or: [
        { username: { $regex: searchParams, $options: "i" } }, // search by username
        { "fitcheck.caption": { $regex: searchParams, $options: "i" } }, // search by fitcheck caption
        { "fitcheck.listings.name": { $regex: searchParams, $options: "i" } }, // search by listing name
        { "fitcheck.listings.brand": { $regex: searchParams, $options: "i" } }, // search by listing brand
        {
          "fitcheck.listings.category": { $regex: searchParams, $options: "i" },
        }, // search by listing category
        { "fitcheck.listings.size": { $regex: searchParams, $options: "i" } }, // search by listing size
        {
          "fitcheck.listings.condition": {
            $regex: searchParams,
            $options: "i",
          },
        }, // search by listing condition
      ],
    });

    //Sanitize Usernames
    const filteredUsernames = results.filter(
      (user) => user.username !== currentusername
    );
    let usernamesArray = filteredUsernames;

    //Sanitize Fitchecks
    const filteredFitchecks = results.map((user) =>
      user.fitcheck.map((fitcheck) => {
        if (fitcheck.video.caption === searchParams) {
          return fitcheck;
        }
      })
    );
    const fitchecksSanitized = filteredFitchecks.map((arr) =>
      arr.filter((element) => element !== undefined)
    );

    let fitceckArray = [];
    fitchecksSanitized.map((item) => {
      item.forEach((arr) => {
        fitceckArray.push(arr);
      });
    });

    //Sanitize Listings
    const filteredListings = results.map((user) =>
      user.fitcheck.map((fitcheck) =>
        fitcheck.listings.map((listing) => {
          if (listing.name === searchParams) {
            return listing;
          }
        })
      )
    );
    const lisitingsSanitized = filteredListings.map((arr) =>
      arr.map((morearr) => morearr)
    );

    let lisitingArray = [];
    lisitingsSanitized.map((item) => {
      item.forEach((arr) =>
        arr.map((item) => {
          lisitingArray.push(item);
        })
      );
    });

    const removeNullFromListing = lisitingArray.filter(
      (item) => item !== undefined
    );
    lisitingArray = removeNullFromListing;

    res.status(200).json({
      users: usernamesArray,
      fitchecks: fitceckArray,
      listings: lisitingArray,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// SET A comment (of a fitcheck)
router.post("/addcomment", async (req, res) => {
  const username = req.body.username;
  const fitcheckId = req.body.fitcheckId;
  const commentText = req.body.text;

  try {
    const user = await User.findOne({
      "fitcheck._id": fitcheckId,
    });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const fitcheck = user.fitcheck.find((f) => f._id.toString() === fitcheckId);

    if (!fitcheck) {
      return res.status(404).json({ message: "Fitcheck not found" });
    }

    const comment = {
      text: commentText,
      username: username,
    };

    fitcheck.comments.push(comment);
    await user.save();

    res.json({ message: "Comment added successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get all comments (of a fitcheck)
router.post("/getcomments", async (req, res) => {
  try {
    const fitcheckId = req.body.fitcheckId;
    const user = await User.findOne({ "fitcheck._id": fitcheckId });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const fitcheck = user.fitcheck.find(
      (fitcheck) => fitcheck._id == req.body.fitcheckId
    );

    if (!fitcheck) {
      return res.status(404).json({ message: "Fitcheck not found" });
    }

    res.json(fitcheck.comments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error" });
  }
});

// Delete a comment (of a fitcheck)
router.post("/deletecomment", async (req, res) => {
  try {
    const fitcheckId = req.body.fitcheckId;
    const commentId = req.body.commentId;
    const user = await User.findOne({ "fitcheck._id": fitcheckId });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find the fitcheck with the given ID
    const fitcheck = user.fitcheck.find((f) => f._id == fitcheckId);

    if (!fitcheck) {
      return res.status(404).json({ message: "Fitcheck not found" });
    }

    // Find the comment with the given ID in the fitcheck
    const comment = fitcheck.comments.find((c) => c._id == commentId);

    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    // Remove the comment
    await comment.deleteOne();

    // Save the user document
    await user.save();

    res.json({ message: "Comment deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error" });
  }
});

// Set Avatar (of a user)
router.post("/setAvatar", async (req, res) => {
  const username = req.body.username;
  const image = req.body.image;

  try {
    // Find the user by their username
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    //Make the new image ready for saving
    const compressedImage = await compressImage(req.body.image);

    // decode the base64-encoded image data to a buffer
    const buffer = Buffer.from(compressedImage, "base64");

    const uniqueFilename = await generateUniqueFilename(
      req.body.username,
      bucket
    );

    // upload the buffer to GridFS
    const uploadStream = bucket.openUploadStream(uniqueFilename);
    const readStream = new Readable();
    readStream.push(buffer);
    readStream.push(null);
    readStream.pipe(uploadStream);

    // save the file metadata to the images array of the listing object
    const fileData = {
      filename: uniqueFilename,
      contentType: "image/jpeg",
    };

    user.avatar = fileData;
    await user.save();

    // Return the newly added listing ID
    res.status(200).json({
      message: "Success",
    });
  } catch (error) {
    res.status(400).json({ message: "There was error in the request." });
  }
});

// GET a Avatar (of a user)
router.post("/getAvatar", async (req, res) => {
  const username = req.body.username;

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const filename = user.avatar.filename;

    const stream = bucket.openDownloadStreamByName(filename);
    const chunks = [];

    stream.on("data", (chunk) => {
      chunks.push(chunk);
    });

    stream.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const base64Image = buffer.toString("base64");

      res.status(200).json({ image: base64Image });
    });

    stream.on("error", (err) => {
      console.error(err);
      res.status(500).json({ message: "Error getting Avatar" });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error getting Listing" });
  }
});

// GET a user (complete object)
router.post("/getUser", async (req, res) => {
  const username = req.body.username;
  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ user: user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error getting User" });
  }
});

module.exports = router;
