const express = require('express');
const session = require('express-session');
const multer = require('multer');
const QRCode = require('qrcode');
const path = require('path');

const app = express();

// Multer Disk Storage Setup Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public/uploads/'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// System Middleware Configuration
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'mware_secret_production_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if deploying with explicit HTTPS on custom servers
}));

// In-Memory Virtual Ecosystem Database
let products = [
    { id: 1, name: 'Mware Edition Watch', price: 129.99, currency: 'USD', status: 'In Stock', image: 'https://unsplash.com' }
];
let contactInfo = { phone: '+1 234 567 890', email: 'support@mwareshop.com', address: '123 Tech Street' };
let users = { 'admin@mwareshop.com': { password: 'adminpassword', role: 'admin' } };

// Dynamic Environmental Holiday Adaptation Engine
function getHolidayTheme() {
    const month = new Date().getMonth() + 1; 
    const day = new Date().getDate();
    if (month === 12) return { name: 'Christmas', bg: 'bg-red-900', text: 'text-white', accent: 'border-green-500' };
    if (month === 10 && day >= 25) return { name: 'Halloween', bg: 'bg-orange-950', text: 'text-orange-100', accent: 'border-orange-500' };
    return { name: 'Standard', bg: 'bg-slate-900', text: 'text-slate-100', accent: 'border-indigo-500' };
}

// Global Core Middleware Pipeline (QR Code, Themes, Context Synchronization)
app.use(async (req, res, next) => {
    try {
        const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        res.locals.qrCode = await QRCode.toDataURL(fullUrl);
    } catch (err) {
        res.locals.qrCode = '';
    }
    res.locals.theme = getHolidayTheme();
    res.locals.cartCount = req.session.cart ? req.session.cart.length : 0;
    res.locals.user = req.session.user || null;
    next();
});

// --- CUSTOMER MODULE PATHWAYS ---

// Storefront Dashboard Landing
app.get('/', (req, res) => {
    res.render('dashboard', { products, contactInfo, activeTab: 'shop' });
});

// Append Item to Transaction Cart
app.post('/cart/add', (req, res) => {
    if (!req.session.cart) req.session.cart = [];
    const prod = products.find(p => p.id == req.body.productId);
    if (prod && prod.status === 'In Stock') {
        req.session.cart.push(prod);
    }
    res.redirect('/');
});

// Render Checkout Matrix Summary
app.get('/checkout', (req, res) => {
    const cart = req.session.cart || [];
    res.render('dashboard', { cart, contactInfo, activeTab: 'checkout' });
});

// Complete Cart Payment Order Fulfillment
app.post('/checkout/pay', (req, res) => {
    req.session.cart = []; 
    res.send("<script>alert('Order placed successfully via Mware Gateway!'); window.location='/';</script>");
});

// --- AUTHENTICATION PORTAL PATHWAYS ---

// Render Universal Entry Portal UI
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// Separate Branch: Process Customer Logins
app.post('/login/customer', (req, res) => {
    const { email, password } = req.body;
    if (!users[email]) {
        users[email] = { password, role: 'customer' };
    }
    if (users[email].password === password && users[email].role === 'customer') {
        req.session.user = { email, role: 'customer' };
        return res.redirect('/');
    }
    res.render('login', { error: 'Invalid customer credentials.' });
});

// Separate Branch: Process Administrative Logins
app.post('/login/admin', (req, res) => {
    const { email, password } = req.body;
    if (users[email] && users[email].password === password && users[email].role === 'admin') {
        req.session.user = { email, role: 'admin' };
        return res.redirect('/admin');
    }
    res.render('login', { error: 'Access denied. Invalid administrator credentials.' });
});

// Clear Authentication Context
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- ADMINISTRATIVE SECURITY GUARD ---
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.status(403).send('Access Denied. Secure Administrative Permissions Required.');
};

// --- ADMINISTRATIVE MANAGEMENT PATHWAYS ---

// Admin Central Command Terminal
app.get('/admin', isAdmin, (req, res) => {
    res.render('admin', { products, contactInfo });
});

// Add New Product Entity (With Disk Image Processing)
app.post('/admin/product/add', isAdmin, upload.single('image'), (req, res) => {
    const { name, price, currency, status } = req.body;
    const image = req.file ? `/public/uploads/${req.file.filename}` : 'https://unsplash.com';
    products.push({ 
        id: Date.now(), 
        name, 
        price: parseFloat(price), 
        currency, 
        status, 
        image 
    });
    res.redirect('/admin');
});

// Toggle Product Stock Allocation Configuration
app.post('/admin/product/toggle/:id', isAdmin, (req, res) => {
    const prod = products.find(p => p.id == req.params.id);
    if (prod) {
        prod.status = prod.status === 'In Stock' ? 'Out of Stock' : 'In Stock';
    }
    res.redirect('/admin');
});

// Purge Product Entity from System Database Record
app.post('/admin/product/delete/:id', isAdmin, (req, res) => {
    products = products.filter(p => p.id != req.params.id);
    res.redirect('/admin');
});

// Update Public Identity Contact Values
app.post('/admin/contact/update', isAdmin, (req, res) => {
    contactInfo = { 
        phone: req.body.phone, 
        email: req.body.email, 
        address: req.body.address 
    };
    res.redirect('/admin');
});

// --- RUNTIME LIVE LISTENER ASSIGNMENT ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Mware Shop server pipeline actively serving on port ${PORT}`));

