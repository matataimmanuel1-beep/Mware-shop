const express = require('express');
const session = require('express-session');
const multer = require('multer');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Database Connection configuration using DATABASE_URL from Railway
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Setup Multer Storage for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Application Middleware Setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-key-for-shopping-site',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// Context Engine Middleware for Themes and Notifications
app.use((req, res, next) => {
    res.locals.theme = req.session.theme || 'default';
    res.locals.user = req.session.user || null;
    res.locals.error = req.session.error || null;
    res.locals.success = req.session.success || null;
    req.session.error = null;
    req.session.success = null;
    next();
});

// DB Initialization Setup Helper
async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(20) DEFAULT 'customer'
            );
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                description TEXT,
                image_url VARCHAR(255),
                status VARCHAR(50) DEFAULT 'In Stock'
            );
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id),
                total_amount DECIMAL(10,2) NOT NULL,
                status VARCHAR(50) DEFAULT 'Pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("Database initialized successfully.");
    } catch (err) {
        console.error("Database initialization failed:", err.message);
    }
}
initializeDatabase();

// ROUTING ARCHITECTURE
app.get('/', async (req, res) => {
    try {
        const prodRes = await pool.query('SELECT * FROM products ORDER BY id DESC');
        res.render('dashboard', { products: prodRes.rows, activeTab: 'home' });
    } catch (err) {
        res.status(500).send("Server Error loading storefront.");
    }
});

app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('login');
});

// NEW PIPELINE: Customer Registration Endpoint Validation
app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        // Assert existing registration records identity conflict
        const checkRes = await pool.query('SELECT * FROM users WHERE email = $1 OR username = $2', [email, username]);
        if (checkRes.rows.length > 0) {
            req.session.error = "Email or username parameter already actively bound to another user.";
            return res.redirect('/login');
        }

        // Insert new entity mapping default to client 'customer' properties 
        const insertRes = await pool.query(
            'INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role',
            [username, email, password, 'customer']
        );
        
        const freshUser = insertRes.rows[0];
        // Inject operational authentication tokens into current session scope instantly
        req.session.user = { id: freshUser.id, username: freshUser.username, email: freshUser.email, role: freshUser.role };
        req.session.success = "Account profile initiated successfully! Welcome.";
        res.redirect('/');
    } catch (err) {
        req.session.error = "Failed to commit user account record registration parameters.";
        res.redirect('/login');
    }
});

// Unified Dynamic Sign In Processor
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userRes.rows.length === 0) {
            req.session.error = "User not registered in database indices.";
            return res.redirect('/login');
        }
        
        const user = userRes.rows[0];
        if (user.password !== password) {
            req.session.error = "Invalid credential authorization strings.";
            return res.redirect('/login');
        }

        req.session.user = { id: user.id, username: user.username, email: user.email, role: user.role };
        
        if (user.role === 'admin') {
            return res.redirect('/admin');
        }
        res.redirect('/');
    } catch (err) {
        req.session.error = "Internal structural backend pipeline offline.";
        res.redirect('/login');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Dashboard Content Mappings
app.get('/orders', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    try {
        const orderRes = await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC', [req.session.user.id]);
        res.render('dashboard', { orders: orderRes.rows, activeTab: 'orders' });
    } catch (err) {
        res.status(500).send("Error compiling orders.");
    }
});

app.post('/orders/checkout', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: "Unauthorized access" });
    const { amount } = req.body;
    try {
        await pool.query('INSERT INTO orders (user_id, total_amount, status) VALUES ($1, $2, $3)', [req.session.user.id, amount, 'Pending']);
        res.json({ success: true, message: "Order placed via local portal pipeline." });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/orders/update-status', async (req, res) => {
    if (!req.session.user) return res.status(401).send("Unauthorized Access Gateway.");
    const { orderId, status } = req.body;
    try {
        if (req.session.user.role === 'admin') {
            await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, orderId]);
        } else {
            await pool.query('UPDATE orders SET status = $1 WHERE id = $2 AND user_id = $3', [status, orderId, req.session.user.id]);
        }
        res.redirect(req.session.user.role === 'admin' ? '/admin' : '/orders');
    } catch (err) {
        res.status(500).send("Database Mutation Exception.");
    }
});

// Admin Panel Control Route Context Setup
app.get('/admin', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Access Forbidden.");
    }
    try {
        const prodRes = await pool.query('SELECT * FROM products ORDER BY id DESC');
        const orderRes = await pool.query('SELECT o.*, u.username FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.id DESC');
        const adminRes = await pool.query('SELECT username, email FROM users WHERE role = $1 LIMIT 1', ['admin']);
        
        res.render('admin', {
            products: prodRes.rows,
            orders: orderRes.rows,
            adminProfile: adminRes.rows[0] || { username: req.session.user.username, email: req.session.user.email }
        });
    } catch (err) {
        res.status(500).send("Admin Module failed to parse dashboard configuration arrays.");
    }
});

app.post('/admin/product/add', upload.single('image'), async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send("Forbidden");
    const { name, price, description } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : '/uploads/default.jpg';
    
    try {
        await pool.query('INSERT INTO products (name, price, description, image_url) VALUES ($1, $2, $3, $4)', [name, price, description, imageUrl]);
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send("Failed to commit transactional inventory item adjustments.");
    }
});

app.post('/admin/product/toggle/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send("Forbidden");
    const { id } = req.params;
    const { status } = req.body;
    try {
        await pool.query('UPDATE products SET status = $1 WHERE id = $2', [status, id]);
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send("Failed product visibility modification.");
    }
});

app.post('/admin/product/delete/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send("Forbidden");
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM products WHERE id = $1', [id]);
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send("Database Constraint rejection deleting system entity.");
    }
});

app.post('/theme/switch', (req, res) => {
    const { theme } = req.body;
    req.session.theme = theme;
    res.json({ success: true, activeTheme: theme });
});

app.listen(PORT, () => console.log(`Active server operating node binding parameters on port ${PORT}`));

