const path = require('path');

const express = require('express');
const bodyParser = require('body-parser');

const adminRoutes = require('./routes/admin');
const shopRoutes = require('./routes/shop');

const errorController = require('./controllers/error');
const sequelize = require('./util/database');
const Product = require('./models/product');
const User = require('./models/user');
const Cart = require('./models/cart');
const CartItem = require('./models/cart-item');
const Order = require('./models/order');
const OrderItem = require('./models/order-item');

const app = express();

app.set('view engine', 'ejs');
app.set('views', 'views');

app.use(bodyParser.urlencoded({ extended: false })); // Parses body like we used to do manually in previous http version of this project
app.use(express.static(path.join(__dirname, 'public'))); // Grant read access to the public folder statically

app.use((req, res, next) => {
  User.findByPk(1)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch((err) => {
      console.log(err);
    });
}); // Storing dummy user to be able to use it anywhere in the app

app.use('/admin', adminRoutes);
app.use(shopRoutes);

app.use(errorController.get404);

/* Associations
1) A product is created by one user
2) A user can create many products
3) A user has one cart only
4) A cart belongs to a user
5) A Cart can have many products
6) A product belongs to many carts
7) A order belongs to a user
8) A user has many orders
9) A order belongs to many products
*/

Product.belongsTo(User, { constraints: true, onDelete: 'CASCADE' }); // A user who created a product that gets deleted, product also gets deleted
User.hasMany(Product); // belongTo (one to many relationship)
User.hasOne(Cart);
Cart.belongsTo(User);
Cart.belongsToMany(Product, { through: CartItem });
Product.belongsToMany(Cart, { through: CartItem });
Order.belongsTo(User);
User.hasMany(Order);
Order.belongsToMany(Product, { through: OrderItem });

sequelize
  .sync()
  .then(() => {
    return User.findByPk(1);
  })
  .then((user) => {
    if (!user) {
      return User.create({
        name: 'Mohamed',
        email: 'test@test.com',
      });
    }

    return user;
  })
  .then((user) => {
    // return user.createCart();
  })
  .then(() => {
    app.listen(3000);
  })
  .catch((err) => {
    console.log(err);
  });
