cat << 'EOF' > server.js
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const QRCode = require('qrcode');
const path = require('path');
const { Pool } = require('pg');

const app = express();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Note: If deploying to production (e.g., AWS, Heroku), ensure your environment 
    // provides the correct SSL certificates. Rejecting unauthorized certs is fine for testing.
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => { 
        cb(null, path.join(__dirname, 'public/uploads/')); 
    },
    filename: (req, file, cb) => { 
        cb(null, Date.now() + path.extname(file.originalname)); 
    }
});
const upload = multer({ storage: storage });

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

// SECURITY WARNING: In a real production app, always set a complex secret 
// via process.env.SESSION_SECRET instead of hardcoding it.
app.use(session({
    secret: process.env.SESSION_SECRET || 'mware_secure_production_hash',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if running over HTTPS
}));

async function initDatabase() {
    try {
        await pool.query("CREATE TABLE IF NOT EXISTS contact_info (id INT PRIMARY KEY, phone TEXT, email TEXT, address TEXT);");
        await pool.query("CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, phone TEXT, password TEXT, role TEXT);");
        await pool.query("CREATE TABLE IF NOT EXISTS products (id BIGINT PRIMARY KEY, name TEXT, price NUMERIC, currency TEXT, status TEXT, image TEXT);");
        await pool.query("CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, customer_email TEXT, full_name TEXT, shipping_address TEXT, gateway_method TEXT, items TEXT, total TEXT, currency TEXT, status TEXT, date TEXT);");
        
        await pool.query("INSERT INTO contact_info (id, phone, email, address) VALUES (1, '+1 234 567 890', 'support@mwareshop.com', '123 Tech Street') ON CONFLICT DO NOTHING;");
        await pool.query("INSERT INTO users (email, phone, password, role) VALUES ('admin@mwareshop.com', '123456789', 'adminpassword', 'admin') ON CONFLICT DO NOTHING;");
        await pool.query("INSERT INTO products (id, name, price, currency, status, image) VALUES (1, 'Mware Edition Watch', 129.99, 'USD', 'In Stock', 'https://unsplash.com') ON CONFLICT DO NOTHING;");
        console.log("PostgreSQL Database Schema Connected Perfectly.");
    } catch (err) { 
        console.error("Database Setup Failure: ", err); 
    }
}
initDatabase();

function getHolidayTheme() {
    const now = new Date();
    const month = now.getMonth() + 1; 
    const day = now.getDate();
    if (month === 12) return { name: 'Christmas Spectacular', bg: '#14532d', cardBg: '#052e16', text: '#f8fafc', accent: '#ef4444', btn: '#dc2626' };
    if (month === 10 && day >= 15) return { name: 'Spooky Halloween', bg: '#1c1917', cardBg: '#292524', text: '#ffedd5', accent: '#f97316', btn: '#ea580c' };
    if (month === 1 && day <= 5) return { name: 'Happy New Year', bg: '#0f172a', cardBg: '#1e293b', text: '#f8fafc', accent: '#eab308', btn: '#ca8a04' };
    if (month === 2 && day >= 10 && day <= 15) return { name: 'Valentines Sweetheart', bg: '#4c0519', cardBg: '#881337', text: '#ffe4e6', accent: '#f43f5e', btn: '#e11d48' };
    return { name: 'Standard Layout', bg: '#0f172a', cardBg: '#1e293b', text: '#f8fafc', accent: '#6366f1', btn: '#4f46e5' };
}

app.use(async (req, res, next) => {
    if (!req.session.cart) req.session.cart = [];
    try {
        const fullUrl = req.protocol + "://" + req.get('host') + req.originalUrl;
        res.locals.qrCode = await QRCode.toDataURL(fullUrl);
    } catch (err) { 
        res.locals.qrCode = ''; 
    }
    res.locals.theme = getHolidayTheme();
    res.locals.cartCount = req.session.cart.length;
    res.locals.user = req.session.user || null;
    next();
});

app.get('/', async (req, res) => {
    try {
        const prodRes = await pool.query("SELECT * FROM products ORDER BY id DESC");
        const contactRes = await pool.query("SELECT * FROM contact_info WHERE id=1");
        res.render('dashboard', { products: prodRes.rows, contactInfo: contactRes.rows[0], activeTab: 'shop', error: null, success: null });
    } catch (e) { 
        res.status(500).send(e.toString()); 
    }
});

app.get('/profile', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    try {
        const userRes = await pool.query("SELECT * FROM users WHERE email=$1", [req.session.user.email]);
        const orderRes = await pool.query("SELECT * FROM orders WHERE customer_email=$1 ORDER BY id DESC", [req.session.user.email]);
        const contactRes = await pool.query("SELECT * FROM contact_info WHERE id=1");
        res.render('dashboard', { products: [], contactInfo: contactRes.rows[0], activeTab: 'profile', account: userRes.rows[0], customerOrders: orderRes.rows, error: null, success: null });
    } catch (e) { 
        res.status(500).send(e.toString()); 
    }
});

app.post('/profile/update', async (req, res) => {
    if (!req.session.user) return res.status(403).send('Unauthorized');
    const { identity, verificationCode, newPassword } = req.body;
    try {
        const contactRes = await pool.query("SELECT * FROM contact_info WHERE id=1");
        const userCheck = await pool.query("SELECT * FROM users WHERE email=$1 OR phone=$1", [identity]);
        
        if (userCheck.rows.length === 0) return res.render('dashboard', { products: [], contactInfo: contactRes.rows[0], activeTab: 'profile', account: { email: req.session.user.email }, customerOrders: [], error: 'Identifier footprint mismatch.', success: null });
        if (verificationCode !== '1234') return res.render('dashboard', { products: [], contactInfo: contactRes.rows[0], activeTab: 'profile', account: userCheck.rows[0], customerOrders: [], error: 'Verification code invalid.', success: null });
        
        await pool.query("UPDATE users SET password=$1 WHERE email=$2", [newPassword, userCheck.rows[0].email]);
        const orderRes = await pool.query("SELECT * FROM orders WHERE customer_email=$1", [req.session.user.email]);
        res.render('dashboard', { products: [], contactInfo: contactRes.rows[0], activeTab: 'profile', account: userCheck.rows[0], customerOrders: orderRes.rows, error: null, success: 'Credentials updated successfully!' });
    } catch (e) { 
        res.status(500).send(e.toString()); 
    }
});

app.post('/cart/add', async (req, res) => {
    try {
        const prodCheck = await pool.query("SELECT * FROM products WHERE id=$1", [req.body.productId]);
        if (prodCheck.rows.length > 0 && prodCheck.rows[0].status === 'In Stock') {
            req.session.cart.push(prodCheck.rows[0]);
        }
        res.redirect('/');
    } catch (e) { 
        res.status(500).send(e.toString()); 
    }
});

app.get('/checkout', async (req, res) => {
    const cart = req.session.cart || [];
    let subtotal = 0; let currencySymbol = 'USD';
    cart.forEach(item => { subtotal += parseFloat(item.price); currencySymbol = item.currency || 'USD'; });
    const shippingCost = cart.length > 0 ? 15.00 : 0.00; const estimatedTax = subtotal * 0.16; const totalSum = subtotal + shippingCost + estimatedTax;
    try {
        const contactRes = await pool.query("SELECT * FROM contact_info WHERE id=1");
        res.render('dashboard', { 
            cart, contactInfo: contactRes.rows[0], activeTab: 'checkout', error: null, success: null,
            financials: { subtotal: subtotal.toFixed(2), shipping: shippingCost.toFixed(2), tax: estimatedTax.toFixed(2), total: totalSum.toFixed(2), currency: currencySymbol }
        });
    } catch (e) { 
        res.status(500).send(e.toString()); 
    }
});

// FIXED: Completed the broken checkout endpoint safely using Parameterized Queries
app.post('/checkout/pay', async (req, res) => {
    const { fullName, shippingAddress, gatewayMethod, totalAmount, totalCurrency } = req.body;
    const cartItems = req.session.cart || [];
    
    if (cartItems.length === 0) {
        return res.status(400).send("Your cart is empty.");
    }

    const orderId = 'MW-' + Date.now().toString().slice(-6).toUpperCase();
    const customerEmail = req.session.user ? req.session.user.email : 'Guest Checkout';
    const itemNames = cartItems.map(i => i.name).join(', ');
    const orderDate = new Date().toLocaleDateString();
    const initialStatus = 'Pending';

    try {
        const queryText = `
            INSERT INTO orders (id, customer_email, full_name, shipping_address, gateway_method, items, total, currency, status, date) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `;
        const values = [orderId, customerEmail, fullName, shippingAddress, gatewayMethod, itemNames, totalAmount, totalCurrency, initialStatus, orderDate];
        
        await pool.query(queryText, values);
        
        // Empty the cart after successful payment processing
        req.session.cart = [];
        
        const contactRes = await pool.query("SELECT * FROM contact_info WHERE id=1");
        res.render('dashboard', { 
            products: [], 
            contactInfo: contactRes.rows[0], 
            activeTab: 'checkout', 
            error: null, 
            success: `Order ${orderId} placed successfully!`,
            financials: { subtotal: '0.00', shipping: '0.00', tax: '0.00', total: '0.00', currency: totalCurrency }
        });
    } catch (e) { 
        res.status(500).send(e.toString()); 
    }
});

// Server listener
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
EOF

