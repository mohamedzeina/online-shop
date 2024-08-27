const express = require('express');
const bodyParser = require('body-parser');

const adminRoutes = require('./routes/admin');
const shopRoutes = require('./routes/shop');

const app = express();

app.use(bodyParser.urlencoded({ extended: false })); // Parses body like we used to do manually in previous http version of this project

app.use(adminRoutes);
app.use(shopRoutes);

app.listen(3000);
