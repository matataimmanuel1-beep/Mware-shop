const express = require('express');
const session = require('express-session');
const multer = require('multer');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public'), {
    maxAge: '7d' // cache static files for speed
}));

// Security headers (basic)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.use(session({
    secret: process.env.SESSION_SECRET || 'mware_secure_production_hash_change_me',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
}));

// ====================== DATABASE INIT ======================
async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS contact_info (
                id INT PRIMARY KEY, phone TEXT, email TEXT, address TEXT
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                email TEXT PRIMARY KEY,
                phone TEXT,
                password TEXT,
                role TEXT,
                reset_code TEXT
            );
        `);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code TEXT`);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                id BIGINT PRIMARY KEY,
                name TEXT,
                price NUMERIC,
                currency TEXT,
                status TEXT,
                image TEXT,
                category TEXT DEFAULT 'General',
                description TEXT DEFAULT ''
            );
        `);
        // Add missing columns safely
        await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General'`);
        await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                customer_email TEXT,
                full_name TEXT,
                shipping_address TEXT,
                gateway_method TEXT,
                items TEXT,
                total TEXT,
                currency TEXT,
                status TEXT,
                date TEXT
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_email TEXT,
                message TEXT,
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Default admin
        const adminExists = await pool.query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
        if (adminExists.rows.length === 0) {
            await pool.query(
                "INSERT INTO users (email, phone, password, role) VALUES ($1,$2,$3,$4)",
                ['admin@mwareshop.com', '123456789', 'adminpassword', 'admin']
            );
            console.log("✅ Default admin → admin@mwareshop.com / adminpassword");
        }

        // Contact
        const contactExists = await pool.query("SELECT 1 FROM contact_info WHERE id = 1");
        if (contactExists.rows.length === 0) {
            await pool.query(
                "INSERT INTO contact_info (id, phone, email, address) VALUES (1,$1,$2,$3)",
                ['+254 700 000 000', 'support@mwareshop.com', 'Mombasa, Kenya']
            );
        }

        console.log("✅ Database ready");
    } catch (err) {
        console.error("❌ DB Error:", err);
    }
}
initDatabase();

// ====================== HELPERS ======================
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

async function createNotification(email, message) {
    try {
        await pool.query(
            "INSERT INTO notifications (user_email, message) VALUES ($1, $2)",
            [email, message]
        );
    } catch (e) { console.error(e); }
}

// ====================== GLOBAL MIDDLEWARE ======================
app.use(async (req, res, next) => {
    if (!req.session.cart) req.session.cart = [];
    
    try {
        const fullUrl = req.protocol + "://" + req.get('host');
        res.locals.siteUrl = fullUrl;
        res.locals.qrCode = await QRCode.toDataURL(fullUrl);
    } catch (err) {
        res.locals.qrCode = '';
        res.locals.siteUrl = '';
    }
    
    res.locals.theme = getHolidayTheme();
    res.locals.cartCount = req.session.cart.length;
    res.locals.user = req.session.user || null;
    res.locals.isAdminView = req.session.isAdminView || false;
    next();
});

// ====================== PUBLIC ROUTES ======================
app.get('/', async (req, res) => {
    try {
        const category = req.query.category || '';
        let query = "SELECT * FROM products ORDER BY id DESC";
        let params = [];
        
        if (category) {
            query = "SELECT * FROM products WHERE category = $1 ORDER BY id DESC";
            params = [category];
        }
        
        const prodRes = await pool.query(query, params);
        const categoriesRes = await pool.query("SELECT DISTINCT category FROM products ORDER BY category");
        const contactRes = await pool.query("SELECT * FROM contact_info WHERE id = 1");
        
        res.render('dashboard', {
            products: prodRes.rows,
            categories: categoriesRes.rows,
            selectedCategory: category,
            contactInfo: contactRes.rows[0] || { phone: '+254 700 000 000', email: 'support@mwareshop.com', address: 'Mombasa, Kenya' },
            activeTab: 'shop',
            error: null,
            success: null
        });
    } catch (e) {
        res.status(500).send(e.toString());
    }
});

// Product Detail Page
app.get('/product/:id', async (req, res) => {
    try {
        const prod = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
        if (prod.rows.length === 0) return res.status(404).send('Product not found');
        
        const contactRes = await pool.query("SELECT * FROM contact_info WHERE id = 1");
        
        res.render('product', {
            product: prod.rows[0],
            contactInfo: contactRes.rows[0] || {}
        });
    } catch (e) {
        res.status(500).send(e.toString());
    }
});

app.get('/profile', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    try {
        const userRes = await pool.query("SELECT * FROM users WHERE email = $1", [req.session.user.email]);
        const orderRes = await pool.query(
            "SELECT * FROM orders WHERE customer_email = $1 ORDER BY id DESC",
            [req.session.user.email]
        );
        const notifRes = await pool.query(
            "SELECT * FROM notifications WHERE user_email = $1 ORDER BY created_at DESC LIMIT 10",
            [req.session.user.email]
        );
        const contactRes = await pool.query("SELECT * FROM contact_info WHERE id = 1");
        
        res.render('dashboard', {
            products: [],
            contactInfo: contactRes.rows[0] || {},
            activeTab: 'profile',
            account: userRes.rows[0] || { email: req.session.user.email },
            customerOrders: orderRes.rows,
            notifications: notifRes.rows,
            error: null,
            success: null
        });
    } catch (e) {
        res.status(500).send(e.toString());
    }
});

app.post('/cart/add', async (req, res) => {
    try {
        const prodCheck = await pool.query("SELECT * FROM products WHERE id = $1", [req.body.productId]);
        if (prodCheck.rows.length > 0 && prodCheck.rows[0].status === 'In Stock') {
            req.session.cart.push(prodCheck.rows[0]);
        }
        res.redirect(req.get('Referer') || '/');
    } catch (e) {
        res.status(500).send(e.toString());
    }
});

app.get('/checkout', async (req, res) => {
    const cart = req.session.cart || [];
    let subtotal = 0;
    let currencySymbol = 'Ksh';
    cart.forEach(item => {
        subtotal += parseFloat(item.price);
        currencySymbol = item.currency || 'Ksh';
    });
    const financials = {
        subtotal: subtotal.toFixed(2),
        shipping: (cart.length > 0 ? 150 : 0).toFixed(2),
        tax: (subtotal * 0.16).toFixed(2),
        total: (subtotal * 1.16 + (cart.length > 0 ? 150 : 0)).toFixed(2),
        currency: currencySymbol
    };
    const contactRes = await pool.query("SELECT * FROM contact_info WHERE id = 1");
    res.render('dashboard', {
        cart,
        contactInfo: contactRes.rows[0] || {},
        activeTab: 'checkout',
        financials,
        error: null,
        success: null
    });
});

app.post('/checkout/pay', async (req, res) => {
    const { fullName, shippingAddress, gatewayMethod, totalAmount, totalCurrency } = req.body;
    const cartItems = req.session.cart || [];
    const orderId = 'MW-' + Date.now().toString().slice(-6).toUpperCase();
    const customerEmail = req.session.user ? req.session.user.email : 'Guest Checkout';
    const itemNames = cartItems.map(i => i.name).join(', ');
    const orderDate = new Date().toLocaleDateString();

    try {
        await pool.query(
            `INSERT INTO orders (id, customer_email, full_name, shipping_address, gateway_method, items, total, currency, status, date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [orderId, customerEmail, fullName, shippingAddress, gatewayMethod, itemNames, totalAmount, totalCurrency, 'Pending', orderDate]
        );
        
        // Notifications
        if (req.session.user) {
            await createNotification(customerEmail, `Your order ${orderId} has been placed successfully.`);
        }
        await createNotification('admin@mwareshop.com', `New order ${orderId} received from ${fullName}`);
        
        req.session.cart = [];
        res.send("<script>alert('Order placed successfully!'); window.location='/';</script>");
    } catch (e) {
        res.status(500).send(e.toString());
    }
});

// ====================== AUTH ======================
app.get('/login', (req, res) => res.render('login', { message: null }));
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const found = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (found.rows.length > 0 && found.rows[0].password === password) {
            req.session.user = { email: found.rows[0].email, role: found.rows[0].role };
            req.session.isAdminView = found.rows[0].role === 'admin';
            return found.rows[0].role === 'admin' ? res.redirect('/admin') : res.redirect('/');
        }
        res.render('login', { message: 'Invalid email or password.' });
    } catch (e) {
        res.status(500).send(e.toString());
    }
});

app.get('/register', (req, res) => res.render('register', { message: null }));
app.post('/register', async (req, res) => {
    const { email, phone, password } = req.body;
    try {
        const exists = await pool.query("SELECT 1 FROM users WHERE email = $1", [email]);
        if (exists.rows.length > 0) {
            return res.render('register', { message: 'Email already registered.' });
        }
        await pool.query(
            "INSERT INTO users (email, phone, password, role) VALUES ($1,$2,$3,'customer')",
            [email, phone, password]
        );
        req.session.user = { email, role: 'customer' };
        res.redirect('/');
    } catch (e) {
        res.render('register', { message: 'Registration failed.' });
    }
});

// System generates random code
app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { message: null, success: false, generatedCode: null });
});

app.post('/forgot-password', async (req, res) => {
    const { email, newPassword, verificationCode, action } = req.body;

    try {
        if (action === 'request') {
            // Generate random 6-digit code
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            const user = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
            
            if (user.rows.length === 0) {
                return res.render('forgot-password', {
                    message: 'No account found with that email.',
                    success: false,
                    generatedCode: null
                });
            }
            
            await pool.query("UPDATE users SET reset_code = $1 WHERE email = $2", [code, email]);
            
            // For demo: show the code (in real app you would email it)
            return res.render('forgot-password', {
                message: 'A verification code has been generated. Use it below.',
                success: true,
                generatedCode: code,
                email: email
            });
        }

        // Reset action
        const user = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (user.rows.length === 0) {
            return res.render('forgot-password', { message: 'Account not found.', success: false, generatedCode: null });
        }
        if (!user.rows[0].reset_code || user.rows[0].reset_code !== verificationCode) {
            return res.render('forgot-password', { message: 'Invalid verification code.', success: false, generatedCode: null });
        }

        await pool.query(
            "UPDATE users SET password = $1, reset_code = NULL WHERE email = $2",
            [newPassword, email]
        );
        
        res.render('forgot-password', {
            message: 'Password reset successfully! You can now login.',
            success: true,
            generatedCode: null
        });
    } catch (e) {
        console.error(e);
        res.render('forgot-password', { message: 'Error occurred.', success: false, generatedCode: null });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// Switch view (Admin only)
app.get('/switch-view', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
    req.session.isAdminView = !req.session.isAdminView;
    res.redirect(req.session.isAdminView ? '/admin' : '/');
});

// ====================== ADMIN ======================
app.get('/admin', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send('Admin access required');
    }
    try {
        const [adminRes, accountsRes, productsRes, ordersRes, contactRes, notifRes] = await Promise.all([
            pool.query("SELECT * FROM users WHERE role = 'admin' LIMIT 1"),
            pool.query("SELECT * FROM users WHERE role = 'customer' ORDER BY email"),
            pool.query("SELECT * FROM products ORDER BY id DESC"),
            pool.query("SELECT * FROM orders ORDER BY id DESC"),
            pool.query("SELECT * FROM contact_info WHERE id = 1"),
            pool.query("SELECT * FROM notifications WHERE user_email = 'admin@mwareshop.com' OR user_email LIKE '%admin%' ORDER BY created_at DESC LIMIT 15")
        ]);

        res.render('admin', {
            products: productsRes.rows,
            contactInfo: contactRes.rows,
            adminProfile: adminRes.rows,
            orders: ordersRes.rows,
            accounts: accountsRes.rows,
            notifications: notifRes.rows
        });
    } catch (e) {
        res.status(500).send(e.toString());
    }
});

app.post('/admin/orders/update-status', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
    try {
        await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [req.body.targetStatus, req.body.orderId]);
        
        // Notify customer
        const order = await pool.query("SELECT customer_email FROM orders WHERE id = $1", [req.body.orderId]);
        if (order.rows[0] && order.rows[0].customer_email !== 'Guest Checkout') {
            await createNotification(order.rows[0].customer_email, `Your order ${req.body.orderId} is now: ${req.body.targetStatus}`);
        }
        
        res.redirect('/admin');
    } catch (e) {
        res.status(500).send(e.toString());
    }
});

app.post('/admin/self/update', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
    const { newAdminEmail, newAdminPhone, newAdminPassword } = req.body;
    await pool.query(
        "UPDATE users SET email=$1, phone=$2, password=$3 WHERE role='admin'",
        [newAdminEmail, newAdminPhone, newAdminPassword]
    );
    req.session.user.email = newAdminEmail;
    res.redirect('/admin');
});

app.post('/admin/accounts/modify', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
    await pool.query("UPDATE users SET password=$1 WHERE email=$2", [req.body.updatedPassword, req.body.targetEmail]);
    res.redirect('/admin');
});

app.post('/admin/product/add', upload.single('image'), async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
    
    const { name, price, currency, status, externalImageUrl, category, description } = req.body;
    let image = 'https://via.placeholder.com/400';
    if (externalImageUrl?.trim()) image = externalImageUrl.trim();
    else if (req.file) image = '/public/uploads/' + req.file.filename;

    await pool.query(
        `INSERT INTO products (id, name, price, currency, status, image, category, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [Date.now(), name, parseFloat(price), currency || 'Ksh', status || 'In Stock', image, category || 'General', description || '']
    );
    res.redirect('/admin');
});

app.post('/admin/product/toggle/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
    const prod = await pool.query("SELECT status FROM products WHERE id=$1", [req.params.id]);
    if (prod.rows[0]) {
        const next = prod.rows[0].status === 'In Stock' ? 'Out of Stock' : 'In Stock';
        await pool.query("UPDATE products SET status=$1 WHERE id=$2", [next, req.params.id]);
    }
    res.redirect('/admin');
});

app.post('/admin/product/delete/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
    await pool.query("DELETE FROM products WHERE id=$1", [req.params.id]);
    res.redirect('/admin');
});

app.post('/admin/contact/update', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
    await pool.query(
        "UPDATE contact_info SET phone=$1, email=$2, address=$3 WHERE id=1",
        [req.body.phone, req.body.email, req.body.address]
    );
    res.redirect('/admin');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Mware Shop running on port ${PORT}`));
