import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { createAuth } from "./auth.js";

dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  }),
);

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const mongoClient = await connectToMongoDB();

const db = mongoClient.db("StudioSpace");
const usersCollection = db.collection("users");
const studiosCollection = db.collection("studios");
const bookingsCollection = db.collection("bookings");

const auth = createAuth(db);
app.all("/api/auth/{*any}", toNodeHandler(auth));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("StudioSpace Server is Running!");
});

app.get("/api/studios", async (req, res) => {
  try {
    const { category } = req.query;
    const filter = { status: "active" };
    if (category) {
      filter.category = category;
    }

    const studios = await studiosCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();
    res.status(200).send({ success: true, data: studios });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Failed to fetch studios" });
  }
});

app.get("/api/my-studios", async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      return res.status(401).send({
        success: false,
        message: "Unauthorized",
      });
    }

    const studios = await studiosCollection
      .find({ hostEmail: session.user.email })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).send({ success: true, data: studios });
  } catch (error) {
    res.status(500).send({
      success: false,
      message: "Failed to fetch your studios",
    });
  }
});

app.get("/api/studios/featured", async (req, res) => {
  try {
    const featuredStudios = await studiosCollection
      .find({ status: "active" })
      .sort({ rating: -1, createdAt: -1 })
      .limit(6)
      .toArray();
    res.status(200).send({ success: true, data: featuredStudios });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Failed to fetch featured studios" });
  }
});

app.get("/api/studios/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const studio = await studiosCollection.findOne({ _id: new ObjectId(id) });
    if (!studio) {
      return res
        .status(404)
        .send({ success: false, message: "Studio not found" });
    }
    res.status(200).send({ success: true, data: studio });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to fetch studio" });
  }
});

app.post("/api/studios", async (req, res) => {
  try {
    // Verify logged-in user
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      return res.status(401).send({
        success: false,
        message: "Unauthorized",
      });
    }

    const {
      title,
      category,
      hourlyRate,
      securityDeposit,
      capacity,
      location,
      address,
      image,
      amenities,
      overview,
    } = req.body;

    if (
      !title ||
      !category ||
      !hourlyRate ||
      securityDeposit == null ||
      !capacity ||
      !location ||
      !address ||
      !image ||
      !overview
    ) {
      return res.status(400).send({
        success: false,
        message: "All required fields must be provided",
      });
    }

    const newStudio = {
      title,
      category,
      hourlyRate: Number(hourlyRate),
      securityDeposit: Number(securityDeposit),
      capacity: Number(capacity),
      location,
      address,
      image,
      amenities: Array.isArray(amenities) ? amenities : [],
      overview,

      // Host information comes from verified session
      hostName: session.user.name,
      hostEmail: session.user.email,

      status: "active",
      rating: 0,
      createdAt: new Date(),
    };

    const result = await studiosCollection.insertOne(newStudio);

    res.status(201).send({
      success: true,
      message: "Studio added successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Add studio error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to add studio",
    });
  }
});

app.delete("/api/studios/:id", async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      return res.status(401).send({
        success: false,
        message: "Unauthorized",
      });
    }

    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid studio ID",
      });
    }

    const result = await studiosCollection.deleteOne({
      _id: new ObjectId(id),
      hostEmail: session.user.email,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "Studio not found",
      });
    }

    res.status(200).send({
      success: true,
      message: "Studio deleted successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({
      success: false,
      message: "Failed to delete studio",
    });
  }
});

app.put("/api/studios/:id", async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid studio ID" });
    }

    const {
      title,
      category,
      hourlyRate,
      securityDeposit,
      capacity,
      location,
      address,
      image,
      amenities,
      overview,
    } = req.body;

    const result = await studiosCollection.updateOne(
      {
        _id: new ObjectId(id),
        hostEmail: session.user.email,
      },
      {
        $set: {
          title,
          category,
          hourlyRate: Number(hourlyRate),
          securityDeposit: Number(securityDeposit),
          capacity: Number(capacity),
          location,
          address,
          image,
          amenities,
          overview,
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "Studio not found" });
    }

    res.send({ success: true, message: "Studio updated successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to update studio" });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
