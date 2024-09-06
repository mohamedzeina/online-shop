# Online Shop

This project is an **e-commerce platform** built using the **MVC architecture** with Node.js and Express.js. It allows users to browse and purchase products, while admins can manage products, users, and orders through an admin panel.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Installation](#installation)

## Features

- User authentication (registration, login, password reset)
- Product listing with search and filtering options
- Shopping cart and checkout process
- Order management for customers and admins
- Admin panel for managing products, users, and orders


## Tech Stack

- **Backend:** Node.js, Express.js
- **Frontend:** EJS (Embedded JavaScript) templating engine
- **Database:** MongoDB with Mongoose
- **Authentication:**
- **Payment Gateway:**


## Architecture

This project follows the **Model-View-Controller (MVC)** pattern:

- **Model:** MongoDB collections, with schema definitions handled by Mongoose.
- **View:** EJS (Embedded JavaScript) templating engine
- **Controller:** Business logic is handled by Express.js controllers, interacting with models and rendering appropriate views or sending JSON responses.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/mohamedzeina/online-shop.git
   cd online-shop
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm start
   ```.
