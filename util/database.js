const mongodb = require('mongodb');
const MongoClient = mongodb.MongoClient;

const mongoConnect = (callback) => {
  MongoClient.connect(
    'mongodb+srv://toxiczeina:shjZPqvFPxW1yKSp@node-complete.r6fat.mongodb.net/?retryWrites=true&w=majority&appName=node-complete'
  )
    .then((client) => {
      console.log('Connected to DB Successfully!');
      callback(client);
    })
    .catch((err) => console.log(err));
};

module.exports = mongoConnect;
