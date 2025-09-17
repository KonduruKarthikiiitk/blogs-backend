const express = require("express");
const { body, validationResult, query } = require("express-validator");
const Post = require("../models/Post");
const User = require("../models/User");
const auth = require("../middleware/auth");

const router = express.Router();

// @route   GET /api/posts
// @desc    Get all posts with pagination and filtering
// @access  Public
router.get(
  "/",
  [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage("Limit must be between 1 and 50"),
    query("tag").optional().trim(),
    query("author").optional().isMongoId().withMessage("Invalid author ID"),
    query("search").optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        page = 1,
        limit = 10,
        tag,
        author,
        search,
        sort = "createdAt",
      } = req.query;

      // Build filter object
      const filter = {};

      if (tag) filter.tags = { $in: [new RegExp(tag, "i")] };
      if (author) filter.author = author;

      // Text search - search in title, content, and tags
      if (search) {
        const searchRegex = new RegExp(search, "i");
        filter.$or = [
          { title: searchRegex },
          { content: searchRegex },
          { tags: { $in: [searchRegex] } },
        ];
      }

      // Calculate pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Build sort object
      const sortObj = {};
      if (sort === "createdAt") sortObj.createdAt = -1;
      else if (sort === "views") sortObj.views = -1;
      else if (sort === "likes") sortObj.likeCount = -1;

      const posts = await Post.find(filter)
        .populate("author", "username firstName lastName avatar")
        .sort(sortObj)
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
      console.error("Get posts error:", error);
      res.status(500).json({ message: "Server error while fetching posts" });
    }
  }
);

// @route   GET /api/posts/:id
// @desc    Get single post by ID or slug
// @access  Public
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Check if it's a MongoDB ObjectId or slug
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
    const query = isObjectId ? { _id: id } : { slug: id };

    const post = await Post.findOne(query)
      .populate("author", "username firstName lastName avatar bio")
      .populate("comments.author", "username firstName lastName avatar");

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    // All posts are now visible to everyone (no status field)

    // Increment view count
    post.views += 1;
    await post.save();

    res.json({ post });
  } catch (error) {
    console.error("Get post error:", error);
    res.status(500).json({ message: "Server error while fetching post" });
  }
});

// @route   POST /api/posts
// @desc    Create new post
// @access  Private
router.post(
  "/",
  [
    auth,
    body("title")
      .notEmpty()
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage("Title must be between 1 and 200 characters"),
    body("content")
      .notEmpty()
      .isLength({ min: 1, max: 50000 })
      .withMessage("Content must be between 1 and 50000 characters"),
    body("tags").optional().isArray().withMessage("Tags must be an array"),
    body("featuredImage")
      .optional()
      .trim()
      .custom((value) => {
        if (!value) return true; // Optional field
        // Check if it's a valid URL or base64 data URL
        const isUrl = /^https?:\/\/.+/.test(value);
        const isBase64 = /^data:image\/[a-zA-Z]*;base64,/.test(value);
        if (isUrl || isBase64) return true;
        throw new Error(
          "Featured image must be a valid URL or base64 data URL"
        );
      }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { title, content, tags = [], featuredImage } = req.body;

      // Generate slug from title
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      // Check if slug already exists
      const existingPost = await Post.findOne({ slug });
      if (existingPost) {
        return res
          .status(400)
          .json({ message: "A post with this title already exists" });
      }

      const post = new Post({
        title,
        content,
        slug,
        author: req.userId,
        tags: tags.map((tag) => tag.toLowerCase().trim()),
        featuredImage,
      });

      await post.save();
      await post.populate("author", "username firstName lastName avatar");

      res.status(201).json({
        message: "Post created successfully",
        post,
      });
    } catch (error) {
      console.error("Create post error:", error);
      res.status(500).json({ message: "Server error while creating post" });
    }
  }
);

// @route   PUT /api/posts/:id
// @desc    Update post
// @access  Private
router.put(
  "/:id",
  [
    auth,
    body("title")
      .optional()
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage("Title must be between 1 and 200 characters"),
    body("content")
      .optional()
      .isLength({ min: 1, max: 50000 })
      .withMessage("Content must be between 1 and 50000 characters"),
    body("tags").optional().isArray().withMessage("Tags must be an array"),
    body("featuredImage")
      .optional()
      .trim()
      .custom((value) => {
        if (!value) return true; // Optional field
        // Check if it's a valid URL or base64 data URL
        const isUrl = /^https?:\/\/.+/.test(value);
        const isBase64 = /^data:image\/[a-zA-Z]*;base64,/.test(value);
        if (isUrl || isBase64) return true;
        throw new Error(
          "Featured image must be a valid URL or base64 data URL"
        );
      }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const post = await Post.findById(id);

      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      // Check if user is the author or admin
      const isAuthor = post.author.toString() === req.userId.toString();
      console.log("Authorization check:", {
        postAuthor: post.author.toString(),
        reqUserId: req.userId.toString(),
        userRole: req.user.role,
        isAuthor: isAuthor,
      });

      if (!isAuthor && req.user.role !== "admin") {
        return res
          .status(403)
          .json({ message: "Not authorized to update this post" });
      }

      const updateData = req.body;

      // If title is being updated, generate new slug
      if (updateData.title && updateData.title !== post.title) {
        const newSlug = updateData.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");

        // Check if new slug already exists
        const existingPost = await Post.findOne({
          slug: newSlug,
          _id: { $ne: id },
        });
        if (existingPost) {
          return res
            .status(400)
            .json({ message: "A post with this title already exists" });
        }
        updateData.slug = newSlug;
      }

      const updatedPost = await Post.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
      }).populate("author", "username firstName lastName avatar");

      res.json({
        message: "Post updated successfully",
        post: updatedPost,
      });
    } catch (error) {
      console.error("Update post error:", error);
      res.status(500).json({ message: "Server error while updating post" });
    }
  }
);

// @route   DELETE /api/posts/:id
// @desc    Delete post
// @access  Private
router.delete("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const post = await Post.findById(id);

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    // Check if user is the author or admin
    const isAuthor = post.author.toString() === req.userId.toString();
    console.log("Delete authorization check:", {
      postAuthor: post.author.toString(),
      reqUserId: req.userId.toString(),
      userRole: req.user.role,
      isAuthor: isAuthor,
    });

    if (!isAuthor && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ message: "Not authorized to delete this post" });
    }

    await Post.findByIdAndDelete(id);

    res.json({ message: "Post deleted successfully" });
  } catch (error) {
    console.error("Delete post error:", error);
    res.status(500).json({ message: "Server error while deleting post" });
  }
});

// @route   POST /api/posts/:id/like
// @desc    Like/unlike a post
// @access  Private
router.post("/:id/like", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const post = await Post.findById(id);

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const isLiked = post.likes.includes(req.userId);

    if (isLiked) {
      post.likes.pull(req.userId);
    } else {
      post.likes.push(req.userId);
    }

    await post.save();

    res.json({
      message: isLiked ? "Post unliked" : "Post liked",
      isLiked: !isLiked,
      likeCount: post.likes.length,
      post: {
        _id: post._id,
        likes: post.likes,
        likeCount: post.likes.length,
      },
    });
  } catch (error) {
    console.error("Like post error:", error);
    res.status(500).json({ message: "Server error while liking post" });
  }
});

// @route   POST /api/posts/:id/comments
// @desc    Add comment to post
// @access  Private
router.post(
  "/:id/comments",
  [
    auth,
    body("content")
      .notEmpty()
      .trim()
      .isLength({ min: 1, max: 1000 })
      .withMessage("Comment must be between 1 and 1000 characters"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { content } = req.body;

      const post = await Post.findById(id);

      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      const comment = {
        author: req.userId,
        content,
        createdAt: new Date(),
        isApproved: true,
      };

      post.comments.push(comment);
      await post.save();

      await post.populate(
        "comments.author",
        "username firstName lastName avatar"
      );

      const newComment = post.comments[post.comments.length - 1];

      res.status(201).json({
        message: "Comment added successfully",
        comment: newComment,
        post: {
          _id: post._id,
          comments: post.comments,
          commentCount: post.comments.length,
        },
      });
    } catch (error) {
      console.error("Add comment error:", error);
      res.status(500).json({ message: "Server error while adding comment" });
    }
  }
);

module.exports = router;
