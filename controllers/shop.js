const fs = require('fs');
const path = require('path');

const PDFDocument = require('pdfkit');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const Product = require('../models/product');
const Order = require('../models/order');
const Review = require('../models/review');
const { sendOrderConfirmation } = require('../util/email');
const { buildRatingsMap } = require('../util/reviewHelpers');
const pg = require('../util/paginationHelper');

const REVIEWS_PER_PAGE = 5;

const REVIEW_SORT_OPTS = {
  newest:  { createdAt: -1 },
  highest: { rating: -1, createdAt: -1 },
  lowest:  { rating: 1,  createdAt: -1 },
};

function buildStockError(items) {
  const names = items.map((p) => p.productId.title).join(', ');
  return `${names} ${items.length === 1 ? 'is' : 'are'} out of stock or have insufficient quantity. Please update your cart.`;
}

function createStripeSession(cartProducts, req) {
  const baseUrl = req.protocol + '://' + req.get('host');
  return stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: cartProducts.map((p) => ({
      price_data: {
        currency: 'usd',
        product_data: { name: p.productId.title, description: p.productId.description },
        unit_amount: Math.round(p.productId.price * 100),
      },
      quantity: p.quantity,
    })),
    mode: 'payment',
    success_url: baseUrl + '/checkout/success',
    cancel_url: baseUrl + '/checkout/cancel',
  });
}

exports.getProduct = async (req, res, next) => {
  try {
    const prodId = req.params.productId;
    const activeReviewSort = REVIEW_SORT_OPTS[req.query.reviewSort] ? req.query.reviewSort : 'newest';

    const [product, reviews] = await Promise.all([
      Product.findById(prodId),
      Review.find({ productId: prodId }).sort(REVIEW_SORT_OPTS[activeReviewSort]),
    ]);

    const avgRating = reviews.length
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : null;
    const userReview = req.user
      ? reviews.find((r) => r.userId.toString() === req.user._id.toString())
      : null;
    const ratingBreakdown = [5, 4, 3, 2, 1].map((star) => ({
      star,
      count: reviews.filter((r) => r.rating === star).length,
    }));
    const otherReviews = reviews.filter(
      (r) => !userReview || r._id.toString() !== userReview._id.toString()
    );
    const reviewError = req.flash('reviewError');

    const relatedProducts = await Product.aggregate([
      { $match: { category: product.category, _id: { $ne: product._id } } },
      { $lookup: { from: 'reviews', localField: '_id', foreignField: 'productId', as: '_r' } },
      { $addFields: { _avg: { $ifNull: [{ $avg: '$_r.rating' }, 0] } } },
      { $sort: { _avg: -1, _id: -1 } },
      { $project: { _r: 0, _avg: 0 } },
      { $limit: 4 },
    ]);

    const relatedRatingsMap = await buildRatingsMap(relatedProducts.map((p) => p._id));

    res.render('shop/product-detail', {
      pageTitle: product.title,
      path: '/products',
      product,
      reviews,
      displayedReviews: otherReviews.slice(0, REVIEWS_PER_PAGE),
      reviewsListTotal: otherReviews.length,
      avgRating,
      userReview,
      ratingBreakdown,
      activeReviewSort,
      reviewError: reviewError.length > 0 ? reviewError[0] : null,
      relatedProducts,
      relatedRatingsMap,
    });
  } catch (err) {
    const error = new Error(err);
    error.httpStatusCode = 500;
    next(error);
  }
};

exports.getProductReviews = (req, res, next) => {
  const { productId } = req.params;
  const skip = parseInt(req.query.skip, 10) || 0;
  const activeReviewSort = REVIEW_SORT_OPTS[req.query.reviewSort] ? req.query.reviewSort : 'newest';
  const filter = { productId };
  if (req.user) filter.userId = { $ne: req.user._id };

  return Review.find(filter)
    .sort(REVIEW_SORT_OPTS[activeReviewSort])
    .skip(skip)
    .limit(REVIEWS_PER_PAGE)
    .then((reviews) => {
      res.json({
        reviews: reviews.map((r) => ({
          _id: r._id,
          userName: r.userName,
          rating: r.rating,
          comment: r.comment,
          verifiedPurchase: r.verifiedPurchase,
          createdAt: r.createdAt,
        })),
        hasMore: reviews.length === REVIEWS_PER_PAGE,
      });
    })
    .catch(() => res.status(500).json({ error: 'Failed to load reviews' }));
};

exports.getIndex = (req, res, next) => {
  pg.paginationHelper(req, res, next, 'shop/index', 'Noblecart', '/', {});
};

exports.getCategory = (req, res, next) => {
  const category = req.params.category;
  pg.paginationHelper(req, res, next, 'shop/index', category.charAt(0).toUpperCase() + category.slice(1), `/category/${category}`, { category }, { activeCategory: category });
};

exports.getSearch = (req, res, next) => {
  const query = (req.query.q || '').trim();
  if (!query) return res.redirect('/');

  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  Product.find({ $or: [{ title: regex }, { category: regex }, { description: regex }] })
    .then((products) => {
      if (products.length > 0) {
        return buildRatingsMap(products.map((p) => p._id)).then((ratingsMap) =>
          res.render('shop/search', {
            pageTitle: `"${query}"`,
            path: '/search',
            products,
            query,
            suggestions: [],
            ratingsMap,
          })
        );
      }
      return Product.find({}).limit(4).then((suggestions) =>
        buildRatingsMap(suggestions.map((p) => p._id)).then((ratingsMap) =>
          res.render('shop/search', {
            pageTitle: `"${query}"`,
            path: '/search',
            products: [],
            query,
            suggestions,
            ratingsMap,
          })
        )
      );
    })
    .catch((err) => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.getSearchSuggest = (req, res, next) => {
  const query = (req.query.q || '').trim();
  if (query.length < 2) return res.json({ results: [], query, wishlistedIds: [] });

  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return Product.find({ $or: [{ title: regex }, { category: regex }] })
    .select('title price imageUrl category _id')
    .limit(6)
    .then((products) => {
      const productIds = products.map((p) => p._id);
      return buildRatingsMap(productIds).then((ratingsMap) => {
        const wishlistSet = req.user
          ? new Set(req.user.wishlist.map((i) => i.productId.toString()))
          : new Set();
        const wishlistedIds = products
          .filter((p) => wishlistSet.has(p._id.toString()))
          .map((p) => p._id.toString());

        const results = products.map((p) => ({
          _id: p._id,
          title: p.title,
          price: p.price,
          imageUrl: p.imageUrl,
          category: p.category,
          rating: ratingsMap[p._id.toString()] || null,
        }));

        res.json({ results, query, wishlistedIds });
      });
    })
    .catch(() => res.json({ results: [], query, wishlistedIds: [] }));
};

exports.getCartData = (req, res, next) => {
  return req.user
    .populate('cart.items.productId')
    .then((user) => {
      const items = user.cart.items.map((i) => ({
        productId: i.productId._id,
        title: i.productId.title,
        price: i.productId.price,
        imageUrl: i.productId.imageUrl,
        quantity: i.quantity,
      }));
      res.json({ items });
    })
    .catch((err) => {
      res.status(500).json({ error: 'Failed to load cart' });
    });
};

exports.postCart = (req, res, next) => {
  const prodId = req.body.productId;
  return Product.findById(prodId)
    .then((product) => {
      return req.user.addToCart(product);
    })
    .then(() => {
      const cartCount = req.user.cart.items.reduce((sum, i) => sum + i.quantity, 0);
      if (req.headers['x-requested-with'] === 'fetch') {
        return res.json({ success: true, cartCount });
      }
      res.redirect('/cart');
    })
    .catch((err) => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.postCartUpdate = (req, res, next) => {
  const { productId, action } = req.body;
  let productPrice;

  return Product.findById(productId)
    .then((product) => {
      if (!product) throw new Error('Product not found');
      productPrice = product.price;
      return action === 'increase'
        ? req.user.addToCart(product)
        : req.user.decrementFromCart(productId);
    })
    .then(() => {
      const cartCount = req.user.cart.items.reduce((sum, i) => sum + i.quantity, 0);
      const cartItem = req.user.cart.items.find(
        (i) => i.productId.toString() === productId
      );
      const itemQuantity = cartItem ? cartItem.quantity : 0;
      const itemTotal = (itemQuantity * productPrice).toFixed(2);
      res.json({ cartCount, itemQuantity, itemTotal, removed: itemQuantity === 0 });
    })
    .catch((err) => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.postCartDeleteProduct = (req, res, next) => {
  const prodId = req.body.productId;
  return req.user
    .removeFromCart(prodId)
    .then(() => {
      const cartCount = req.user.cart.items.reduce((sum, i) => sum + i.quantity, 0);
      if (req.headers['x-requested-with'] === 'fetch') {
        return res.json({ success: true, cartCount });
      }
      res.redirect('/cart');
    })
    .catch((err) => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.getOrders = async (req, res, next) => {
  try {
    const statusFilter = req.query.status || 'all';
    const query = { 'user.userId': req.user._id };
    if (statusFilter === 'active') {
      query.status = { $in: ['pending', 'confirmed', 'shipped', 'out_for_delivery'] };
    } else if (statusFilter === 'delivered' || statusFilter === 'canceled') {
      query.status = statusFilter;
    }

    const [orders, [rawCounts]] = await Promise.all([
      Order.find(query).sort({ _id: -1 }),
      Order.aggregate([
        { $match: { 'user.userId': req.user._id } },
        {
          $facet: {
            all:       [{ $count: 'n' }],
            active:    [{ $match: { status: { $in: ['pending', 'confirmed', 'shipped', 'out_for_delivery'] } } }, { $count: 'n' }],
            delivered: [{ $match: { status: 'delivered' } }, { $count: 'n' }],
            canceled:  [{ $match: { status: 'canceled' } },  { $count: 'n' }],
            spent: [
              { $match: { status: { $ne: 'canceled' } } },
              { $unwind: '$products' },
              { $group: { _id: null, total: { $sum: { $multiply: ['$products.quantity', '$products.productData.price'] } } } },
            ],
          },
        },
      ]),
    ]);

    const orderCounts = {
      all:       rawCounts?.all?.[0]?.n       || 0,
      active:    rawCounts?.active?.[0]?.n    || 0,
      delivered: rawCounts?.delivered?.[0]?.n || 0,
      canceled:  rawCounts?.canceled?.[0]?.n  || 0,
    };
    const totalSpent = rawCounts?.spent?.[0]?.total || 0;

    res.render('shop/orders', {
      path: '/orders',
      pageTitle: 'Your Orders',
      orders,
      statusFilter,
      orderCounts,
      totalSpent,
    });
  } catch (err) {
    const error = new Error(err);
    error.httpStatusCode = 500;
    next(error);
  }
};

exports.postReorder = async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.orderId, 'user.userId': req.user._id });
    if (!order) return res.redirect('/orders');

    const productIds = order.products.map((p) => p.productData._id);
    const inStock = await Product.find({ _id: { $in: productIds }, stock: { $gt: 0 } });
    const inStockIds = new Set(inStock.map((p) => p._id.toString()));

    for (const { productData, quantity } of order.products) {
      if (!inStockIds.has(productData._id.toString())) continue;
      const idx = req.user.cart.items.findIndex(
        (i) => i.productId.toString() === productData._id.toString()
      );
      if (idx >= 0) {
        req.user.cart.items[idx].quantity += quantity;
      } else {
        req.user.cart.items.push({ productId: productData._id, quantity });
      }
    }
    await req.user.save();
    res.redirect('/checkout');
  } catch (err) {
    next(err);
  }
};

exports.getCheckout = async (req, res, next) => {
  try {
    const user = await req.user.populate('cart.items.productId');
    const cartProducts = user.cart.items;
    if (cartProducts.length === 0) return res.redirect('/');

    let total = 0;
    cartProducts.forEach((p) => { total += p.quantity * p.productId.price; });

    const outOfStock = cartProducts.filter((p) => p.productId.stock < p.quantity);
    if (outOfStock.length > 0) {
      return res.render('shop/checkout', {
        path: '/checkout',
        pageTitle: 'Checkout',
        products: cartProducts,
        totalSum: total,
        sessionId: null,
        stripePublicKey: process.env.STRIPE_PUB_KEY,
        stockError: buildStockError(outOfStock),
        csrfToken: req.csrfToken(),
      });
    }

    const session = await createStripeSession(cartProducts, req);

    res.render('shop/checkout', {
      path: '/checkout',
      pageTitle: 'Checkout',
      products: cartProducts,
      totalSum: total,
      sessionId: session.id,
      stripePublicKey: process.env.STRIPE_PUB_KEY,
      csrfToken: req.csrfToken(),
    });
  } catch (err) {
    const error = new Error(err);
    error.httpStatusCode = 500;
    next(error);
  }
};

exports.getCheckoutSession = async (req, res, next) => {
  try {
    const user = await req.user.populate('cart.items.productId');
    const cartProducts = user.cart.items;
    if (cartProducts.length === 0) return res.json({ sessionId: null, stockError: null });

    const overStock = cartProducts.filter((p) => p.productId.stock < p.quantity);
    if (overStock.length > 0) {
      return res.json({ sessionId: null, stockError: buildStockError(overStock) });
    }

    const session = await createStripeSession(cartProducts, req);
    res.json({ sessionId: session.id, stockError: null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create session' });
  }
};

exports.getCheckoutSuccess = (req, res, next) => {
  return req.user
    .populate('cart.items.productId')
    .then((user) => {
      const cartItems = user.cart.items;
      const products = cartItems.map((i) => {
        return { quantity: i.quantity, productData: { ...i.productId._doc } };
      });

      const order = new Order({
        user: {
          email: req.user.email,
          userId: req.user._id,
        },
        products: products,
        status: 'pending',
        statusHistory: [{ status: 'pending', timestamp: new Date() }],
      });
      return order.save().then((savedOrder) => {
        return Promise.all(
          cartItems.map((item) =>
            Product.updateOne(
              { _id: item.productId._id },
              { $inc: { stock: -item.quantity } }
            )
          )
        ).then(() => savedOrder);
      });
    })
    .then((order) => {
      sendOrderConfirmation(order, order.user.email).catch(() => {});
      return req.user.clearCart();
    })
    .then(() => {
      res.redirect('/orders');
    })
    .catch((err) => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.postWishlistToggle = (req, res, next) => {
  const prodId = req.body.productId;
  return req.user
    .toggleWishlist(prodId)
    .then(() => {
      const inWishlist = req.user.wishlist.some(
        (i) => i.productId.toString() === prodId.toString()
      );
      res.json({ success: true, inWishlist, wishlistCount: req.user.wishlist.length });
    })
    .catch(() => res.status(500).json({ error: 'Failed to update wishlist' }));
};

exports.getWishlist = (req, res, next) => {
  return req.user
    .populate('wishlist.productId')
    .then((user) => {
      const products = user.wishlist
        .filter((i) => i.productId)
        .map((i) => i.productId);
      return buildRatingsMap(products.map((p) => p._id)).then((ratingsMap) => {
        res.render('shop/wishlist', {
          path: '/wishlist',
          pageTitle: 'Wishlist',
          products,
          ratingsMap,
        });
      });
    })
    .catch((err) => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.getOrderDetail = async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.orderId, 'user.userId': req.user._id });
    if (!order) return next(new Error('No order found.'));
    res.render('shop/order-detail', {
      path: '/orders',
      pageTitle: 'Order Details',
      order,
    });
  } catch (err) {
    next(err);
  }
};

exports.getInvoice = async (req, res, next) => {
  try {
    const orderId = req.params.orderId;
    const order = await Order.findById(orderId);

    if (!order) return next(new Error('No order found.'));
    if (order.user.userId.toString() !== req.user._id.toString()) {
      return next(new Error('Unauthorized access.'));
    }

    const invoiceName = 'invoice-' + orderId + '.pdf';
    const invoicePath = path.join('invoices', invoiceName);
    fs.mkdirSync('invoices', { recursive: true });

    const pdfDoc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 56, bottom: 56, left: 56, right: 56 },
      info: {
        Title: 'Invoice — Noblecart',
        Author: 'Noblecart',
        Creator: 'Noblecart',
      },
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + invoiceName + '"');
    pdfDoc.pipe(fs.createWriteStream(invoicePath));
    pdfDoc.pipe(res);

    // Brand fonts — registered as semantic aliases
    const fontDir = path.join(__dirname, '..', 'public', 'fonts');
    pdfDoc.registerFont('serif',        path.join(fontDir, 'CormorantGaramond-Regular.ttf'));
    pdfDoc.registerFont('serif-bold',   path.join(fontDir, 'CormorantGaramond-Bold.ttf'));
    pdfDoc.registerFont('serif-italic', path.join(fontDir, 'CormorantGaramond-Italic.ttf'));
    pdfDoc.registerFont('sans',         path.join(fontDir, 'Montserrat-Regular.ttf'));
    pdfDoc.registerFont('sans-medium',  path.join(fontDir, 'Montserrat-Medium.ttf'));
    pdfDoc.registerFont('sans-bold',    path.join(fontDir, 'Montserrat-Bold.ttf'));
    pdfDoc.registerFont('mono',         path.join(fontDir, 'JetBrainsMono-Regular.ttf'));
    pdfDoc.registerFont('mono-medium',  path.join(fontDir, 'JetBrainsMono-Medium.ttf'));

    // Editorial palette — warm paper, near-ink, saffron accent
    const INK    = '#1a1612';
    const PAPER  = '#fbf8f3';
    const AMBER  = '#b8730e';
    const MUTED  = '#8a7d6d';
    const HAIR   = '#d9cfc0';

    const pageW = pdfDoc.page.width;
    const pageH = pdfDoc.page.height;
    const ML = 56;
    const MR = pageW - 56;
    const W  = MR - ML;

    // Warm-paper wash
    pdfDoc.rect(0, 0, pageW, pageH).fill(PAPER);

    // ─── EDITORIAL TOP STRIP ───────────────────────────────
    const issueId = orderId.toString().slice(-6).toUpperCase();
    const longId  = '#' + orderId.toString().slice(-8).toUpperCase();
    const dateStr = new Date().toLocaleDateString('en-GB', {
      year: 'numeric', month: 'long', day: '2-digit',
    }).toUpperCase();

    pdfDoc.font('mono').fontSize(7).fillColor(MUTED)
      .text('NOBLECART  /  ISSUE N° ' + issueId, ML, 56, { characterSpacing: 0.8 });
    pdfDoc.font('mono').fontSize(7).fillColor(MUTED)
      .text(dateStr, ML, 56, { width: W, align: 'right', characterSpacing: 0.8 });

    // Hairline + amber tick
    pdfDoc.moveTo(ML, 76).lineTo(MR, 76)
      .strokeColor(HAIR).lineWidth(0.5).stroke();
    pdfDoc.rect(ML, 74, 6, 4).fill(AMBER);

    // ─── DECORATIVE N MARK ────────────────────────────────
    pdfDoc.font('serif-italic').fontSize(20).fillColor(INK)
      .text('N', ML, 96, { lineBreak: false });
    pdfDoc.circle(ML + 16, 102, 1.4).fill(AMBER);

    // ─── HERO MASTHEAD ─────────────────────────────────────
    // Giant italic serif — the single most memorable element
    pdfDoc.font('serif-italic').fontSize(96).fillColor(INK)
      .text('Invoice.', ML - 4, 124, { lineBreak: false });

    // Italic recipient line — feels like a magazine dedication
    pdfDoc.font('serif-italic').fontSize(15).fillColor(MUTED)
      .text('for ' + order.user.email, ML, 234, { width: W * 0.7 });

    // ─── EDITORIAL META BAR ────────────────────────────────
    // Three vertical columns: ORDER / DATE / STATUS — magazine-mast style
    const metaY = 280;
    pdfDoc.moveTo(ML, metaY).lineTo(MR, metaY)
      .strokeColor(INK).lineWidth(0.6).stroke();

    const metaRow = metaY + 14;
    const colW = W / 3;
    const status = order.status
      ? order.status.charAt(0).toUpperCase() + order.status.slice(1).replace(/_/g, ' ')
      : 'Confirmed';

    const drawMeta = (label, value, x, font = 'mono-medium', size = 11) => {
      pdfDoc.font('mono').fontSize(6.5).fillColor(MUTED)
        .text(label, x, metaRow, { characterSpacing: 1.4 });
      pdfDoc.font(font).fontSize(size).fillColor(INK)
        .text(value, x, metaRow + 12, { width: colW - 12, lineBreak: false, ellipsis: true });
    };
    drawMeta('ORDER',  longId,  ML);
    drawMeta('DATE',   dateStr, ML + colW);
    drawMeta('STATUS', status,  ML + colW * 2, 'serif-italic', 14);

    // ─── SECTION DIVIDER WITH AMBER MARK ──────────────────
    const divY = metaY + 60;
    pdfDoc.moveTo(ML, divY).lineTo(ML + W * 0.18, divY)
      .strokeColor(INK).lineWidth(0.6).stroke();
    pdfDoc.rect(ML + W * 0.18 + 6, divY - 2, 10, 4).fill(AMBER);
    pdfDoc.moveTo(ML + W * 0.18 + 22, divY).lineTo(MR, divY)
      .strokeColor(HAIR).lineWidth(0.4).stroke();

    pdfDoc.font('mono').fontSize(7).fillColor(MUTED)
      .text('THE GOODS', ML, divY + 12, { characterSpacing: 1.6 });

    // ─── EDITORIAL ITEM LIST (no table) ───────────────────
    // Each entry: mono index / serif title / italic descriptor / mono total
    let listY = divY + 38;
    const ROW_H = 44;
    let subtotal = 0;

    order.products.forEach((prod, i) => {
      const lineTotal = prod.quantity * prod.productData.price;
      subtotal += lineTotal;
      const idx = String(i + 1).padStart(2, '0');

      pdfDoc.font('mono').fontSize(8).fillColor(MUTED)
        .text(idx, ML, listY + 4, { characterSpacing: 1 });

      pdfDoc.font('serif-bold').fontSize(17).fillColor(INK)
        .text(prod.productData.title, ML + 32, listY - 2, {
          width: W * 0.6, lineBreak: false, ellipsis: true,
        });

      pdfDoc.font('serif-italic').fontSize(11).fillColor(MUTED)
        .text(
          prod.quantity + ' × $' + prod.productData.price.toFixed(2),
          ML + 32, listY + 20,
        );

      pdfDoc.font('mono-medium').fontSize(13).fillColor(INK)
        .text('$' + lineTotal.toFixed(2), ML, listY + 4, {
          width: W, align: 'right',
        });

      const underY = listY + ROW_H - 6;
      pdfDoc.moveTo(ML + 32, underY).lineTo(MR, underY)
        .strokeColor(HAIR).lineWidth(0.3).stroke();

      listY += ROW_H;
    });

    // ─── TOTALS BLOCK (right-aligned, editorial pull-quote) ─
    const totY = listY + 18;
    pdfDoc.font('mono').fontSize(7).fillColor(MUTED)
      .text('SUBTOTAL', ML, totY, { width: W - 90, align: 'right', characterSpacing: 1.4 });
    pdfDoc.font('mono').fontSize(10).fillColor(INK)
      .text('$' + subtotal.toFixed(2), ML, totY - 1, { width: W, align: 'right' });

    pdfDoc.font('mono').fontSize(7).fillColor(MUTED)
      .text('SHIPPING', ML, totY + 16, { width: W - 90, align: 'right', characterSpacing: 1.4 });
    pdfDoc.font('serif-italic').fontSize(11).fillColor(INK)
      .text('Complimentary', ML, totY + 12, { width: W, align: 'right' });

    // Amber rule above the big number
    pdfDoc.moveTo(MR - 180, totY + 44).lineTo(MR, totY + 44)
      .strokeColor(AMBER).lineWidth(0.9).stroke();

    pdfDoc.font('serif-italic').fontSize(12).fillColor(MUTED)
      .text('Total,', ML, totY + 52, { width: W, align: 'right' });

    pdfDoc.font('serif-italic').fontSize(56).fillColor(INK)
      .text('$' + subtotal.toFixed(2), ML, totY + 64, {
        width: W, align: 'right', lineBreak: false,
      });

    // ─── COLOPHON FOOTER ──────────────────────────────────
    // Stays within the bottom margin to avoid PDFKit auto-pagination
    const footY = pageH - 86;
    pdfDoc.moveTo(ML, footY).lineTo(MR, footY)
      .strokeColor(HAIR).lineWidth(0.4).stroke();

    pdfDoc.font('serif-italic').fontSize(9).fillColor(MUTED)
      .text('Set in Cormorant Garamond — composed for one reader.',
            ML, footY + 10, { width: W * 0.55, lineBreak: false });

    pdfDoc.font('mono').fontSize(7).fillColor(MUTED)
      .text('THANK YOU  /  NOBLECART',
            ML + W * 0.55, footY + 12,
            { width: W * 0.27, align: 'center', characterSpacing: 1.6, lineBreak: false });

    pdfDoc.font('mono').fontSize(7).fillColor(MUTED)
      .text('01 / 01', ML, footY + 12,
            { width: W, align: 'right', characterSpacing: 1.6, lineBreak: false });

    pdfDoc.end();
  } catch (err) {
    const error = new Error(err);
    error.httpStatusCode = 500;
    return next(error);
  }
};

exports.postReview = (req, res, next) => {
  const { productId } = req.params;
  const { rating, comment } = req.body;
  const ratingNum = parseInt(rating, 10);

  if (!ratingNum || ratingNum < 1 || ratingNum > 5 || !comment || !comment.trim()) {
    req.flash('reviewError', 'Please select a star rating and write a comment.');
    return res.redirect('/products/' + productId);
  }

  return Order.findOne({ 'user.userId': req.user._id, 'products.productData._id': productId })
    .then((order) => new Review({
      productId,
      userId: req.user._id,
      userName: req.user.name || req.user.email.split('@')[0],
      userAvatar: req.user.avatar || '',
      rating: ratingNum,
      comment,
      verifiedPurchase: !!order,
    }).save())
    .then(() => res.redirect('/products/' + productId))
    .catch((err) => {
      if (err.code === 11000) return res.redirect('/products/' + productId);
      next(new Error(err));
    });
};

exports.putReview = (req, res, next) => {
  const { productId } = req.params;
  const { rating, comment } = req.body;
  const ratingNum = parseInt(rating, 10);

  if (!ratingNum || ratingNum < 1 || ratingNum > 5 || !comment || !comment.trim()) {
    req.flash('reviewError', 'Please select a star rating and write a comment.');
    return res.redirect('/products/' + productId);
  }

  return Review.findOneAndUpdate(
    { productId, userId: req.user._id },
    { rating: ratingNum, comment },
    { new: true }
  )
    .then(() => res.redirect('/products/' + productId))
    .catch((err) => next(new Error(err)));
};

exports.deleteReview = (req, res, next) => {
  const { productId } = req.params;

  return Review.findOneAndDelete({ productId, userId: req.user._id })
    .then(() => res.redirect('/products/' + productId))
    .catch((err) => next(new Error(err)));
};
