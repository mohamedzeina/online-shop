const path = require('path');
const dotenv = require('dotenv');
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const session = require('express-session');
const mongoDBStore = require('connect-mongodb-session')(session);
const csrf = require('csurf');
const flash = require('connect-flash');
const multer = require('multer');

const adminRoutes = require('./routes/admin');
const shopRoutes = require('./routes/shop');
const authRoutes = require('./routes/auth');

const errorController = require('./controllers/error');
const User = require('./models/user');

dotenv.config();

const fileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'images');
  },
  filename: (req, file, cb) => {
    cb(null, new Date().toDateString() + '-' + file.originalname);
  },
});

const fileFilter = (req, file, cb) => {
  if (
    file.mimetype == 'image/png' ||
    file.mimetype == 'image/jpeg' ||
    file.mimetype == 'image/jpg'
  ) {
    cb(null, true);
  } else {
    cb(null, false);
  }
}; // Filter to only accept png, jpeg or jpg file uploads

const app = express();
const store = mongoDBStore({
  uri: process.env.MONGODB_URI,
  collection: 'sessions',
});

const csrfProtection = csrf();

app.set('view engine', 'ejs');
app.set('views', 'views');

app.use(bodyParser.urlencoded({ extended: false })); // Parses body like we used to do manually in previous http version of this project
app.use(
  multer({ storage: fileStorage, fileFilter: fileFilter }).single('image')
); // Using multer to handle image uploads by an admin

app.use(express.static(path.join(__dirname, 'public'))); // Grant read access to the public folder statically
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use(
  session({
    secret: 'my secret',
    resave: false,
    saveUninitialized: false,
    store: store,
  })
); // Session middleware initialized

app.use(csrfProtection); // CSRF middleware
app.use(flash());

app.use((req, res, next) => {
  if (!req.session.user) {
    return next();
  }
  User.findById(req.session.user._id)
    .then((user) => {
      if (!user) {
        return next();
      }
      req.user = user;
      next();
    })
    .catch((err) => {
      next(new Error(err));
    });
}); // Storing dummy user from session in request to get full mongoose user object

app.use((req, res, next) => {
  res.locals.isAuthenticated = req.session.isLoggedIn;
  res.locals.csrfToken = req.csrfToken(); // Provided by CSRF middleware we added
  next();
}); // Every request that is executed will have these fields for the views that are rendered

app.use('/admin', adminRoutes);
app.use(shopRoutes);
app.use(authRoutes);

app.use('/500', errorController.get500);
app.use(errorController.get404);

app.use((error, req, res, next) => {
  res.redirect('/500');
});

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to DB Successfully');
    app.listen(3000);
  })
  .catch((err) => {
    console.log(err);
  });
