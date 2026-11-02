import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { createAuth } from "./auth.js";
import { createRemoteJWKSet, jwtVerify } from "jose";

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
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.BETTER_AUTH_URL}/api/auth/jwks`),
);
const verifyJwtCookie = async (req, res, next) => {
  try {
    const cookies = req.headers.cookie || "";

    const jwtCookie = cookies
      .split(";")
      .find((item) => item.trim().startsWith("studiospace_jwt="));

    if (!jwtCookie) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const token = decodeURIComponent(
      jwtCookie.trim().slice("studiospace_jwt=".length),
    );

    await jwtVerify(token, JWKS, {
      issuer: process.env.BETTER_AUTH_URL,
      audience: process.env.BETTER_AUTH_URL,
    });

    next();
  } catch (error) {
    console.error("JWT verification error:", error);
    return res.status(401).json({
      message: "Invalid or expired JWT",
    });
  }
};

app.post("/api/auth/set-jwt-cookie", async (req, res) => {
  try {
    if (req.headers.origin !== process.env.CLIENT_URL) {
      return res.status(403).json({
        success: false,
        message: "Forbidden origin",
      });
    }

    const headers = fromNodeHeaders(req.headers);

    const session = await auth.api.getSession({ headers });

    if (!session) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { token } = await auth.api.getToken({ headers });

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "JWT token not found",
      });
    }

    res.cookie("studiospace_jwt", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 60 * 1000,
      path: "/",
    });

    res.set("Cache-Control", "no-store");

    return res.status(200).json({
      success: true,
      message: "JWT cookie created",
    });
  } catch (error) {
    console.error("JWT Cookie Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create JWT cookie",
    });
  }
});
app.use(express.json());
app.all("/api/auth/{*any}", toNodeHandler(auth));

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
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid studio ID",
      });
    }
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

app.post("/api/studios", verifyJwtCookie, async (req, res) => {
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
      dailyRate,
      monthlyRate,
      yearlyRate,
      securityDeposit,
      capacity,
      location,
      address,
      image,
      imageGallery,
      amenities,
      overview,
    } = req.body;

    if (
      !title ||
      !category ||
      !hourlyRate ||
      !dailyRate ||
      !monthlyRate ||
      !yearlyRate ||
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
      dailyRate: Number(dailyRate),
      monthlyRate: Number(monthlyRate),
      yearlyRate: Number(yearlyRate),
      securityDeposit: Number(securityDeposit),
      capacity: Number(capacity),
      location,
      address,
      image,
      imageGallery: Array.isArray(imageGallery) ? imageGallery : [image],
      amenities: Array.isArray(amenities) ? amenities : [],
      overview,

      // Host information comes from verified session
      hostName: session.user.name,
      hostEmail: session.user.email,

      status: "active",
      rating: 0,
      totalReviews: 0,
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

app.delete("/api/studios/:id", verifyJwtCookie, async (req, res) => {
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
      dailyRate,
      monthlyRate,
      yearlyRate,
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
          dailyRate: Number(dailyRate),
          monthlyRate: Number(monthlyRate),
          yearlyRate: Number(yearlyRate),
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

app.get("/api/my-bookings", async (req, res) => {
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

    const bookings = await bookingsCollection
      .find({
        userEmail: session.user.email,
        status: { $ne: "Cancelled" },
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).send({
      success: true,
      data: bookings,
    });
  } catch (error) {
    console.error("Fetch bookings error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch bookings",
    });
  }
});

app.post("/api/bookings", verifyJwtCookie, async (req, res) => {
  try {
    console.log(
      "Booking cookies:",
      req.headers.cookie?.split(";").map((c) => c.trim().split("=")[0]),
    );

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      return res.status(401).send({
        success: false,
        message: "Unauthorized",
      });
    }
    const { studioId, bookingDate, startTime, bookingType, duration, guests } =
      req.body;
    const validTypes = ["hourly", "daily", "monthly", "yearly"];

    if (
      !ObjectId.isValid(studioId) ||
      !bookingDate ||
      !/^\d{2}:\d{2}$/.test(startTime || "") ||
      !validTypes.includes(bookingType) ||
      !Number.isInteger(Number(duration)) ||
      Number(duration) < 1 ||
      !Number.isInteger(Number(guests)) ||
      Number(guests) < 1
    ) {
      return res.status(400).send({
        success: false,
        message: "Invalid booking information",
      });
    }

    const [year, month, day] = bookingDate.split("-").map(Number);
    const [hour, minute] = startTime.split(":").map(Number);

    const startAt = new Date(Date.UTC(year, month - 1, day, hour, minute));

    if (
      startAt.getUTCFullYear() !== year ||
      startAt.getUTCMonth() !== month - 1 ||
      startAt.getUTCDate() !== day ||
      hour > 23 ||
      minute > 59
    ) {
      return res.status(400).send({
        success: false,
        message: "Invalid booking date or time",
      });
    }

    const studio = await studiosCollection.findOne({
      _id: new ObjectId(studioId),
      status: "active",
    });

    if (!studio) {
      return res.status(404).send({
        success: false,
        message: "Studio not found",
      });
    }

    if (Number(guests) > studio.capacity) {
      return res.status(400).send({
        success: false,
        message: "Guest count exceeds studio capacity",
      });
    }

    if (studio.hostEmail === session.user.email) {
      return res.status(400).send({
        success: false,
        message: "You cannot book your own studio",
      });
    }

    // Calculate booking end time
    const endAt = new Date(startAt);
    const amount = Number(duration);

    if (bookingType === "hourly") {
      endAt.setUTCHours(endAt.getUTCHours() + amount);
    } else if (bookingType === "daily") {
      endAt.setUTCDate(endAt.getUTCDate() + amount);
    } else if (bookingType === "monthly") {
      const originalDay = endAt.getUTCDate();
      endAt.setUTCDate(1);
      endAt.setUTCMonth(endAt.getUTCMonth() + amount);

      const lastDay = new Date(
        Date.UTC(endAt.getUTCFullYear(), endAt.getUTCMonth() + 1, 0),
      ).getUTCDate();

      endAt.setUTCDate(Math.min(originalDay, lastDay));
    } else if (bookingType === "yearly") {
      const originalMonth = endAt.getUTCMonth();
      const originalDay = endAt.getUTCDate();

      endAt.setUTCDate(1);
      endAt.setUTCFullYear(endAt.getUTCFullYear() + amount);
      endAt.setUTCMonth(originalMonth);

      const lastDay = new Date(
        Date.UTC(endAt.getUTCFullYear(), originalMonth + 1, 0),
      ).getUTCDate();

      endAt.setUTCDate(Math.min(originalDay, lastDay));
    }

    // Check active bookings for overlapping time slots
    // Extra Logic: Pending booking check added beyond the assignment requirements. Sorry.

    const activeBookings = await bookingsCollection
      .find({
        studioId,
        status: { $in: ["Pending", "Confirmed"] },
      })
      .toArray();

    const hasConflict = activeBookings.some((booking) => {
      const existingStart = booking.startAt
        ? new Date(booking.startAt)
        : new Date(`${booking.bookingDate}T${booking.startTime}:00Z`);

      const existingEnd = booking.endAt
        ? new Date(booking.endAt)
        : new Date(`${booking.bookingDate}T${booking.endTime}:00Z`);

      return startAt < existingEnd && endAt > existingStart;
    });

    if (hasConflict) {
      return res.status(409).send({
        success: false,
        message: "This time slot is already booked",
      });
    }

    const rate = {
      hourly: studio.hourlyRate,
      daily: studio.dailyRate,
      monthly: studio.monthlyRate,
      yearly: studio.yearlyRate,
    }[bookingType];

    if (!Number.isFinite(Number(rate)) || Number(rate) < 0) {
      return res.status(400).send({
        success: false,
        message: "Invalid studio rate",
      });
    }

    const securityDeposit = Number(studio.securityDeposit) || 0;
    const totalPrice = amount * Number(rate) + securityDeposit;

    const newBooking = {
      studioId,
      studioTitle: studio.title,
      bookingDate,
      startTime,
      endAt,
      startAt,
      bookingType,
      duration: amount,
      rate: Number(rate),
      guests: Number(guests),
      securityDeposit,
      totalPrice,
      userName: session.user.name,
      userEmail: session.user.email,
      hostEmail: studio.hostEmail,
      status: "Pending",
      createdAt: new Date(),
    };

    const result = await bookingsCollection.insertOne(newBooking);

    res.status(201).send({
      success: true,
      message: "Booking submitted successfully",
      bookingId: result.insertedId,
    });
  } catch (error) {
    console.error("Booking error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to create booking",
    });
  }
});

app.patch("/api/bookings/:id/cancel", async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid booking ID" });
    }

    const result = await bookingsCollection.updateOne(
      {
        _id: new ObjectId(id),
        userEmail: session.user.email,
        status: "Pending",
      },
      {
        $set: {
          status: "Cancelled",
          cancelledBy: session.user.email,
          cancelledAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    if (result.modifiedCount === 0) {
      return res.status(400).send({
        message: "Booking not found or cannot be cancelled",
      });
    }

    res.send({
      success: true,
      message: "Booking cancelled successfully",
    });
  } catch (error) {
    console.error("Cancel booking error:", error);
    res.status(500).send({ message: "Failed to cancel booking" });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
