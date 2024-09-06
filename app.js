const path = require('path');

const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const session = require('express-session');
const mongoDBStore = require('connect-mongodb-session')(session);

const adminRoutes = require('./routes/admin');
const shopRoutes = require('./routes/shop');
const authRoutes = require('./routes/auth');

const errorController = require('./controllers/error');
const User = require('./models/user');

const MONGODB_URI =
  'mongodb+srv://toxiczeina:shjZPqvFPxW1yKSp@node-complete.r6fat.mongodb.net/shop?retryWrites=true&w=majority&appName=node-complete';

const app = express();
const store = mongoDBStore({
  uri: MONGODB_URI,
  collection: 'sessions',
});

app.set('view engine', 'ejs');
app.set('views', 'views');

app.use(bodyParser.urlencoded({ extended: false })); // Parses body like we used to do manually in previous http version of this project
app.use(express.static(path.join(__dirname, 'public'))); // Grant read access to the public folder statically
app.use(
  session({
    secret: 'my secret',
    resave: false,
    saveUninitialized: false,
    store: store,
  })
); // Session middleware initialized

app.use((req, res, next) => {
  if (!req.session.user) {
    return next();
  }
  User.findById(req.session.user._id)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch((err) => {
      console.log(err);
    });
}); // Storing dummy user from session in request to get full mongoose user object

app.use('/admin', adminRoutes);
app.use(shopRoutes);
app.use(authRoutes);

app.use(errorController.get404);

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    User.findOne().then((user) => {
      if (!user) {
        const user = new User({
          name: 'Mohamed',
          email: 'mohamed@test.com',
          cart: {
            items: [],
          },
        });
        user.save();
      }
    });

    console.log('Connected to DB Successfully');
    app.listen(3000);
  })
  .catch((err) => {
    console.log(err);
  });
