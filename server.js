const express = require('express');
const session = require('express-session');
const multer = require('multer');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const app = express();

const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, path.join(__dirname, 'public/uploads/')); },
    filename: (req, file, cb) => { cb(null, Date.now() + path.extname(file.originalname)); }
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

// Robust JSON Persistence Helpers
const DATA_PATHS = {
    products: path.join(__dirname, 'data/products.json'),
    users: path.join(__dirname, 'data/users.json'),
    contact: path.join(__dirname, 'data/contactInfo.json')
};

function readData(key, fallback) {
    try {
        if (!fs.existsSync(DATA_PATHS[key])) fs.writeFileSync(DATA_PATHS[key], JSON.stringify(fallback));
        return JSON.parse(fs.readFileSync(DATA_PATHS[key], 'utf8'));
    } catch (e) { return fallback; }
}

function writeData(key, data) {
    try { fs.writeFileSync(DATA_PATHS[key], JSON.stringify(data, null, 2)); } catch (e) { console.error(e); }
}

// Global In-Memory Sync Cache
let contactInfo = readData('contact', { phone: '+1 234 567 890', email: 'support@mwareshop.com', address: '123 Tech Street' });
let masterUsers = readData('users', []);
let products = readData('products', [
    { id: 1, name: 'Mware Edition Watch', price: 129.99, currency: 'USD', status: 'In Stock', image: 'https://unsplash.com' }
]);

// Seed default administrative keys if missing
if (!masterUsers.find(u => u.role === 'admin')) {
    masterUsers.push({ email: 'admin@mwareshop.com', phone: '123456789', password: 'adminpassword', role: 'admin' });
    writeData('users', masterUsers);
}

// Calendar Dynamic Holiday Customizer Engine
function getHolidayTheme() {
    const now = new Date();
    const month = now.getMonth() + 1; 
    const day = now.getDate();
    
    if (month === 12) {
        return { name: 'Christmas Spectacular', bg: '#14532d', cardBg: '#052e16', text: '#f8fafc', accent: '#ef4444', btn: '#dc2626' };
    }
    if (month === 10 && day >= 15) {
        return { name: 'Spooky Halloween', bg: '#1c1917', cardBg: '#292524', text: '#ffedd5', accent: '#f97316', btn: '#ea580c' };
    }
    if (month === 1 && day <= 5) {
        return { name: 'Happy New Year', bg: '#0f172a', cardBg: '#1e293b', text: '#f8fafc', accent: '#eab308', btn: '#ca8a04' };
    }
    if (month === 2 && day >= 10 && day <= 15) {
        return { name: 'Valentines Sweetheart', bg: '#4c0519', cardBg: '#881337', text: '#ffe4e6', accent: '#f43f5e', btn: '#e11d48' };
    }
    return { name: 'Standard Layout', bg: '#0f172a', cardBg: '#1e293b', text: '#f8fafc', accent: '#6366f1', btn: '#4f46e5' };
}

app.use(async (req, res, next) => {
    if (!req.session.cart) req.session.cart = [];
    try {
        const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        res.locals.qrCode = await QRCode.toDataURL(fullUrl);
    } catch (err) { res.locals.qrCode = ''; }
    res.locals.theme = getHolidayTheme();
    res.locals.cartCount = req.session.cart.length;
    res.locals.user = req.session.user || null;
    next();
});

// Storefront Dashboard Route
app.get('/', (req, res) => {
    res.render('dashboard', { products, contactInfo, activeTab: 'shop', error: null, success: null });
});

// Profile Management Pathway
app.get('/profile', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const fullUser = masterUsers.find(u => u.email === req.session.user.email);
    res.render('dashboard', { products, contactInfo, activeTab: 'profile', account: fullUser, error: null, success: null });
});

// Handle Profile Credentials Reset
app.post('/profile/update', (req, res) => {
    if (!req.session.user) return res.status(403).send('Unauthorized');
    const { identity, verificationCode, newPassword } = req.body;
    
    let target = masterUsers.find(u => u.email === identity || u.phone === identity);
    if (!target) return res.render('dashboard', { products, contactInfo, activeTab: 'profile', account: masterUsers.find(u => u.email === req.session.user.email), error: 'Identifier resource mapping mismatch.', success: null });
    
    if (verificationCode !== '1234') {
        return res.render('dashboard', { products, contactInfo, activeTab: 'profile', account: target, error: 'Verification code invalid (Hint: Use 1234).', success: null });
    }
    
    target.password = newPassword;
    writeData('users', masterUsers);
    res.render('dashboard', { products, contactInfo, activeTab: 'profile', account: target, error: null, success: 'Credentials updated successfully!' });
});

// Cart and Checkout Pathways
app.post('/cart/add', (req, res) => {
    const prod = products.find(p => p.id == req.body.productId);
    if (prod && prod.status === 'In Stock') req.session.cart.push(prod);
    res.redirect('/');
});

app.get('/checkout', (req, res) => {
    res.render('dashboard', { cart: req.session.cart || [], contactInfo, activeTab: 'checkout', error: null, success: null });
});

app.post('/checkout/pay', (req, res) => {
    req.session.cart = []; 
    res.send("<script>alert('Order placed successfully via Mware Gateway!'); window.location='/';</script>");
});

// Core Authentication Entry Nodes
app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login/customer', (req, res) => {
    const { email, password } = req.body;
    const found = masterUsers.find(u => u.email === email && u.role === 'customer');
    if (found && found.password === password) {
        req.session.user = { email: found.email, role: 'customer' };
        return res.redirect('/');
    }
    res.render('login', { error: 'Authentication challenge failed: Invalid client credentials.' });
});

app.post('/login/signup', (req, res) => {
    const { email, phone, password } = req.body;
    if (masterUsers.find(u => u.email === email || u.phone === phone)) {
        return res.render('login', { error: 'Entity footprint collision: Phone or Email already mapped.' });
    }
    masterUsers.push({ email, phone, password, role: 'customer' });
    writeData('users', masterUsers);
    req.session.user = { email, role: 'customer' };
    res.redirect('/');
});

app.post('/login/admin', (req, res) => {
    const { email, password } = req.body;
    const found = masterUsers.find(u => u.email === email && u.role === 'admin');
    if (found && found.password === password) {
        req.session.user = { email: found.email, role: 'admin' };
        return res.redirect('/admin');
    }
    res.render('login', { error: 'Administrative clearance rejected: Access Key Refused.' });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Secure Admin Boundary Interceptor
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') return next();
    res.status(403).send('Forbidden Matrix: Administrative Credentials Required.');
};

app.get('/admin', isAdmin, (req, res) => {
    res.render('admin', { products, contactInfo, accounts: masterUsers.filter(u => u.role !== 'admin') });
});

// Admin Account Adjustment Endpoint
app.post('/admin/accounts/modify', isAdmin, (req, res) => {
    const { targetEmail, updatedPassword } = req.body;
    let matchingUser = masterUsers.find(u => u.email === targetEmail);
    if (matchingUser) {
        matchingUser.password = updatedPassword;
        writeData('users', masterUsers);
    }
    res.redirect('/admin');
});

// Admin Store Management Actions
app.post('/admin/product/add', isAdmin, upload.single('image'), (req, res) => {
    const { name, price, currency, status } = req.body;
    const image = req.file ? `/public/uploads/${req.file.filename}` : 'https://unsplash.com';
    products.push({ id: Date.now(), name, price: parseFloat(price), currency, status, image });
    writeData('products', products);
    res.redirect('/admin');
});

app.post('/admin/product/toggle/:id', isAdmin, (req, res) => {
    const prod = products.find(p => p.id == req.params.id);
    if (prod) prod.status = prod.status === 'In Stock' ? 'Out of Stock' : 'In Stock';
    writeData('products', products);
    res.redirect('/admin');
});

app.post('/admin/product/delete/:id', isAdmin, (req, res) => {
    products = products.filter(p => p.id != req.params.id);
    writeData('products', products);
    res.redirect('/admin');
});

app.post('/admin/contact/update', isAdmin, (req, res) => {
    contactInfo = { phone: req.body.phone, email: req.body.email, address: req.body.address };
    writeData('contact', contactInfo);
    res.redirect('/admin');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Mware Engine running on configuration port ${PORT}`));
