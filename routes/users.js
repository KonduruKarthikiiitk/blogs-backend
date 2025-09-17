const express = require("express");
const { body, validationResult, query } = require("express-validator");
const User = require("../models/User");
const Post = require("../models/Post");
const auth = require("../middleware/auth");

const router = express.Router();

// @route   GET /api/users
// @desc    Get all users (admin only)
// @access  Private
router.get(
  "/",
  [
    auth,
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage("Limit must be between 1 and 50"),
    query("search").optional().trim(),
  ],
  async (req, res) => {
    try {
      // Check if user is admin
      if (req.user.role !== "admin") {
        return res
          .status(403)
          .json({ message: "Access denied. Admin role required." });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { page = 1, limit = 10, search } = req.query;

      // Build filter object
      const filter = {};
      if (search) {
        filter.$or = [
          { username: new RegExp(search, "i") },
          { email: new RegExp(search, "i") },
          { firstName: new RegExp(search, "i") },
          { lastName: new RegExp(search, "i") },
        ];
      }

      // Calculate pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const users = await User.find(filter)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

      const total = await User.countDocuments(filter);

      res.json({
        users,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalUsers: total,
          hasNext: skip + users.length < total,
          hasPrev: parseInt(page) > 1,
        },
      });
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ message: "Server error while fetching users" });
    }
  }
);

// @route   GET /api/users/:id
// @desc    Get user by ID
// @access  Public
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get user's published posts count
    const postsCount = await Post.countDocuments({
      author: id,
      status: "published",
    });

    res.json({
      user: {
        ...user.toObject(),
        postsCount,
      },
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ message: "Server error while fetching user" });
  }
});

// @route   GET /api/users/:id/posts
// @desc    Get user's posts
// @access  Public
router.get(
  "/:id/posts",
  [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage("Limit must be between 1 and 50"),
    query("status")
      .optional()
      .isIn(["draft", "published", "archived"])
      .withMessage("Invalid status"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { page = 1, limit = 10, status = "published" } = req.query;

      // Check if user exists
      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Build filter object
      const filter = { author: id };

      // Only show published posts to non-authenticated users
      if (!req.header("Authorization")) {
        filter.status = "published";
      } else {
        if (status) filter.status = status;
      }

      // Calculate pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const posts = await Post.find(filter)
        .populate("author", "username firstName lastName avatar")
        .sort({ publishedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

      const total = await Post.countDocuments(filter);

      res.json({
        posts,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalPosts: total,
          hasNext: skip + posts.length < total,
          hasPrev: parseInt(page) > 1,
        },
      });
    } catch (error) {
      console.error("Get user posts error:", error);
      res
        .status(500)
        .json({ message: "Server error while fetching user posts" });
    }
  }
);

// @route   PUT /api/users/:id
// @desc    Update user (admin only or own profile)
// @access  Private
router.put(
  "/:id",
  [
    auth,
    body("firstName")
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage("First name must be between 1 and 50 characters"),
    body("lastName")
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage("Last name must be between 1 and 50 characters"),
    body("bio")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Bio must be less than 500 characters"),
    body("avatar")
      .optional()
      .trim()
      .isURL()
      .withMessage("Avatar must be a valid URL"),
    body("role").optional().isIn(["user", "admin"]).withMessage("Invalid role"),
    body("isActive")
      .optional()
      .isBoolean()
      .withMessage("isActive must be a boolean"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const updateData = req.body;

      // Check if user is updating their own profile or is admin
      if (req.userId !== id && req.user.role !== "admin") {
        return res
          .status(403)
          .json({ message: "Not authorized to update this user" });
      }

      // Only admins can change role and isActive
      if (req.user.role !== "admin") {
        delete updateData.role;
        delete updateData.isActive;
      }

      const user = await User.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
      }).select("-password");

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        message: "User updated successfully",
        user,
      });
    } catch (error) {
      console.error("Update user error:", error);
      res.status(500).json({ message: "Server error while updating user" });
    }
  }
);

// @route   DELETE /api/users/:id
// @desc    Delete user (admin only)
// @access  Private
router.delete("/:id", auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ message: "Access denied. Admin role required." });
    }

    const { id } = req.params;

    // Prevent admin from deleting themselves
    if (req.userId === id) {
      return res
        .status(400)
        .json({ message: "Cannot delete your own account" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Delete user's posts
    await Post.deleteMany({ author: id });

    // Delete user
    await User.findByIdAndDelete(id);

    res.json({ message: "User and associated posts deleted successfully" });
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({ message: "Server error while deleting user" });
  }
});

// @route   GET /api/users/stats/overview
// @desc    Get platform statistics (admin only)
// @access  Private
router.get("/stats/overview", auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ message: "Access denied. Admin role required." });
    }

    const [
      totalUsers,
      totalPosts,
      publishedPosts,
      draftPosts,
      totalComments,
      recentUsers,
      recentPosts,
    ] = await Promise.all([
      User.countDocuments(),
      Post.countDocuments(),
      Post.countDocuments({ status: "published" }),
      Post.countDocuments({ status: "draft" }),
      Post.aggregate([
        { $project: { commentCount: { $size: "$comments" } } },
        { $group: { _id: null, total: { $sum: "$commentCount" } } },
      ]),
      User.find()
        .select("username firstName lastName createdAt")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Post.find({ status: "published" })
        .populate("author", "username firstName lastName")
        .select("title slug publishedAt views")
        .sort({ publishedAt: -1 })
        .limit(5)
        .lean(),
    ]);

    const totalCommentsCount = totalComments[0]?.total || 0;

    res.json({
      overview: {
        totalUsers,
        totalPosts,
        publishedPosts,
        draftPosts,
        totalComments: totalCommentsCount,
      },
      recent: {
        users: recentUsers,
        posts: recentPosts,
      },
    });
  } catch (error) {
    console.error("Get stats error:", error);
    res.status(500).json({ message: "Server error while fetching statistics" });
  }
});

module.exports = router;
