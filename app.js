const path = require('path');

const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

const adminRoutes = require('./routes/admin');
const shopRoutes = require('./routes/shop');

const errorController = require('./controllers/error');
// const User = require('./models/user');

const app = express();

app.set('view engine', 'ejs');
app.set('views', 'views');

app.use(bodyParser.urlencoded({ extended: false })); // Parses body like we used to do manually in previous http version of this project
app.use(express.static(path.join(__dirname, 'public'))); // Grant read access to the public folder statically

// app.use((req, res, next) => {
//   User.findById('66d70f0e666e1fffe2d5dd9c')
//     .then((user) => {
//       req.user = new User(user.name, user.email, user.cart, user._id);
//       next();
//     })
//     .catch((err) => {
//       console.log(err);
//     });
// }); // Storing dummy user to be able to use it anywhere in the app

app.use('/admin', adminRoutes);
app.use(shopRoutes);

app.use(errorController.get404);

mongoose
  .connect(
    'mongodb+srv://toxiczeina:shjZPqvFPxW1yKSp@node-complete.r6fat.mongodb.net/shop?retryWrites=true&w=majority&appName=node-complete'
  )
  .then(() => {
    console.log('Connected to DB Successfully');
    app.listen(3000);
  })
  .catch((err) => {
    console.log(err);
  });
