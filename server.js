const express = require('express');
const session = require('express-session');
const multer = require('multer');
const QRCode = require('qrcode');
const path = require('path');
const { Pool } = require('pg');

const app = express();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
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
app.use(session({
    secret: 'mware_secure_production_hash',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

async function initDatabase() {
    try {
        await pool.query("CREATE TABLE IF NOT EXISTS contact_info (id INT PRIMARY KEY, phone TEXT, email TEXT, address TEXT);");
        await pool.query("CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, phone TEXT, password TEXT, role TEXT);");
        await pool.query("CREATE TABLE IF NOT EXISTS products (id BIGINT PRIMARY KEY, name TEXT, price NUMERIC, currency TEXT, status TEXT, image TEXT);");
        await pool.query("CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, customer_email TEXT, full_name TEXT, shipping_address TEXT, gateway_method TEXT, items TEXT, total TEXT, currency TEXT, status TEXT, date TEXT);");
        
        await pool.query("INSERT INTO contact_info (id, phone, email, address) VALUES (1, '+254 700 000 000', 'support@mwareshop.com', 'Mombasa, Kenya') ON CONFLICT DO NOTHING;");
        await pool.query("INSERT INTO users (email, phone, password, role) VALUES ('admin@mwareshop.com', '123456789', 'adminpassword', 'admin') ON CONFLICT DO NOTHING;");
        console.log("PostgreSQL Database Connected.");
    } catch (err) { 
        console.error("Database Error: ", err); 
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
        const fullUrl = req.protocol + "://" + req.get('host') + "/profile";
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
        
        if (userCheck.rows.length === 0) return res.render('dashboard', { products: [], contactInfo: contactRes.rows[0], activeTab: 'profile', account: { email: req.session.user.email }, customerOrders: [], error: 'Identifier mismatch.', success: null });
        if (verificationCode !== '1234') return res.render('dashboard', { products: [], contactInfo: contactRes.rows[0], activeTab: 'profile', account: userCheck.rows[0], customerOrders: [], error: 'Invalid verification token.', success: null });
        
        await pool.query("UPDATE users SET password=$1 WHERE email=$2", [newPassword, userCheck.rows[0].email]);
        res.redirect('/profile');
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
    let subtotal = 0; let currencySymbol = 'Ksh';
    cart.forEach(item => { subtotal += parseFloat(item.price); currencySymbol = item.currency || 'Ksh'; });
    const financials = { subtotal: subtotal.toFixed(2), shipping: (cart.length > 0 ? 150 : 0).toFixed(2), tax: (subtotal * 0.16).toFixed(2), total: (subtotal * 1.16 + (cart.length > 0 ? 150 : 0)).toFixed(2), currency: currencySymbol };
    try {
        const contactRes = await pool.query("SELECT * FROM contact_info WHERE id=1");
        res.render('dashboard', { cart, contactInfo: contactRes.rows[0], activeTab: 'checkout', error: null, success: null, financials });
    } catch (e) { 
        res.status(500).send(e.toString()); 
    }
});

app.post('/checkout/pay', async (req, res) => {
    const { fullName, shippingAddress, gatewayMethod, totalAmount, totalCurrency } = req.body;
    const orderId = 'MW-' + Date.now().toString().slice(-6).toUpperCase();
    const itemNames = (req.session.cart || []).map(i => i.name).join(', ');

    try {
        await pool.query("INSERT INTO orders (id, customer_email, full_name, shipping_address, gateway_method, items, total, currency, status, date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", 
            [orderId, req.session.user ? req.session.user.email : 'Guest', fullName, shippingAddress, gatewayMethod, itemNames, totalAmount, totalCurrency, 'Pending Shipment', new Date().toLocaleDateString()]);
        req.session.cart = [];
        res.send("<script>alert('Order placed successfully!'); window.location = '/';</script>");
    } catch (e) { 
        res.status(500).send(e.toString()); 
    }
});

app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login/customer', async (req, res) => {
    try {
        const found = await pool.query("SELECT * FROM users WHERE email=$1 AND role='customer'", [req.body.email]);
        if (found.rows.length > 0 && found.rows[0].password === req.body.password) {
            req.session.user = { email: found.rows[0].email, role: 'customer' };
            return res.redirect('/');
        }
        res.render('login', { error: 'Invalid client credentials.' });
    } catch (e) { 
        res.status(500).send(e.toString()); 
    }
});

app.post('/login/signup', async (req, res) => {
    try {
        const check = await pool.query("SELECT * FROM users WHERE email=$1 OR phone=$2", [req.body.email, req.body.phone]);
        if (check.rows.length > 0) return res.render('login', { error: 'Email or Phone already mapped.' });
        await pool.query("INSERT INTO users (email, phone, password, role) VALUES ($1,$2,$3,'customer')", [req.body.email, req.body.phone, req.body.password]);
        req.session.user = { email: req.body.email, role: 'customer' };
        res.redirect('/');
    } catch (e) { 
        res.status(500).send(e.toString()); 
    }
});

app.post('/login/admin', async (req, res) => {
    try {
        const found = await pool.query("SELECT * FROM users WHERE email=$1 AND role='admin'", [req.body.email]);
        if (found.rows.length > 0 && found.rows[0].password === req.body.password) {
            req.session.user = { email: found.rows[0].email, role: 'admin' };
            return res.redirect('/admin');
        }
        res.render('login', { error: 'Access Key Refused.' });
    } catch (e) { 
        res.status(500).send(e.toString()); 
    }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') return next();
    res.status(403).send('Administrative Access Required.');
};

app.get('/admin', isAdmin, async (req, res) => {
    try {
const adminRes = await pool.query("SELECT * FROM users WHERE role='admin' LIMIT 1");const accountsRes = await pool.query("SELECT * FROM users WHERE role='customer' ORDER BY email ASC");const productsRes = await pool.query("SELECT * FROM products ORDER BY id DESC");const ordersRes = await pool.query("SELECT * FROM orders ORDER BY id DESC");const contactRes = await pool.query("SELECT * FROM contact_info WHERE id=1");res.render('admin', {products: productsRes.rows, contactInfo: contactRes.rows[0], adminProfile: adminRes.rows[0],orders: ordersRes.rows, accounts: accountsRes.rows});} catch (e) {res.status(500).send(e.toString());}});app.post('/admin/orders/update-status', isAdmin, async (req, res) => {try {await pool.query("UPDATE orders SET status=$1 WHERE id=$2", [req.body.targetStatus, req.body.orderId]);res.redirect('/admin');} catch (e) { res.status(500).send(e.toString()); }});app.post('/admin/self/update', isAdmin, async (req, res) => {try {await pool.query("UPDATE users SET email=$1, phone=$2, password=$3 WHERE role='admin'", [req.body.newAdminEmail, req.body.newAdminPhone, req.body.newAdminPassword]);req.session.user.email = req.body.newAdminEmail;res.redirect('/admin');} catch (e) { res.status(500).send(e.toString()); }});app.post('/admin/accounts/modify', isAdmin, async (req, res) => {try {await pool.query("UPDATE users SET password=$1 WHERE email=$2", [req.body.updatedPassword, req.body.targetEmail]);res.redirect('/admin');} catch (e) { res.status(500).send(e.toString()); }});app.post('/admin/product/add', isAdmin, upload.single('image'), async (req, res) => {const { name, price, currency, status, externalImageUrl } = req.body;let image = 'unsplash.com';if (externalImageUrl && externalImageUrl.trim() !== '') {image = externalImageUrl;} else if (req.file) {image = "/public/uploads/" + req.file.filename;}try {await pool.query("INSERT INTO products (id, name, price, currency, status, image) VALUES ($1,$2,$3,$4,$5,$6)", [Date.now(), name, parseFloat(price), currency, status, image]);res.redirect('/admin');} catch (e) { res.status(500).send(e.toString()); }});app.post('/admin/product/toggle/:id', isAdmin, async (req, res) => {try {const prod = await pool.query("SELECT * FROM products WHERE id=$1", [req.params.id]);if (prod.rows.length > 0) {const nextStatus = prod.rows[0].status === 'In Stock' ? 'Out of Stock' : 'In Stock';await pool.query("UPDATE products SET status=$1 WHERE id=$2", [nextStatus, req.params.id]);}res.redirect('/admin');} catch (e) { res.status(500).send(e.toString()); }});app.post('/admin/product/delete/:id', isAdmin, async (req, res) => {try {await pool.query("DELETE FROM products WHERE id=$1", [req.params.id]);res.redirect('/admin');} catch (e) { res.status(500).send(e.toString()); }});app.post('/admin/contact/update', isAdmin, async (req, res) => {try {await pool.query("UPDATE contact_info SET phone=$1, email=$2, address=$3 WHERE id=1", [req.body.phone, req.body.email, req.body.address]);res.redirect('/admin');} catch (e) { res.status(500).send(e.toString()); }});const PORT = process.env.PORT || 3000;app.listen(PORT, () => console.log("Mware Postgres Engine running on port " + PORT));
