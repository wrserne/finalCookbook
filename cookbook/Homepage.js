const express = require('express');
const mysql = require('mysql');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const session = require('express-session');
const dotenv = require('dotenv');

dotenv.config();

const dbHost = process.env.DB_HOST;
const dbUser = process.env.DB_USER;
const dbPassword = process.env.DB_PASSWORD;
const dbName = process.env.DB_NAME;

router.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true
}));

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/images');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });
const connection = mysql.createConnection({
    host: dbHost,
    user: dbUser,
    password: dbPassword,
    database: dbName
});

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to the database: ' + err.stack);
        return;
    }
    console.log('Connected to the database!');
});

router.set('view engine', 'ejs');
router.use(express.urlencoded({ extended: false }));
router.use(express.static(path.join(__dirname, 'public')));
router.set('views', path.join(__dirname, 'views'));

function requireAuth(req, res, next) {
    if (req.session.authenticated) {
        next();
    } else {
        res.redirect('/login');
    }
}

router.get('/editRecipe/:id', requireAuth, (req, res) => {
    const recipeId = req.params.id;

    const sql = 'SELECT * FROM recipes WHERE id = ?';
    connection.query(sql, [recipeId], (err, results) => {
        if (err) {
            console.error('Error retrieving recipe: ' + err.stack);
            res.status(500).send('Error retrieving recipe.');
            return;
        }

        if (results.length === 0) {
            res.status(404).send('Recipe not found.');
            return;
        }

        const recipe = results[0];
        res.render('editRecipe', { recipe });
    });
});

router.post('/updateRecipe/:id', requireAuth, upload.single('newPhoto'), (req, res) => {
    const recipeId = req.params.id;
    const { title, ingredients, instructions, familySecrets, type, makes } = req.body;
    const newImageUrl = req.file ? '/images/' + req.file.filename : '/images/default-photo.jpg';
    const userId = req.session.userId;

    const sql = 'UPDATE recipes SET title=?, ingredients=?, instructions=?, family_secrets=?, type=?, image_url=?, userId=?, makes=? WHERE id=?';
    const params = [title, ingredients, instructions, familySecrets, type, newImageUrl, userId, makes, recipeId];

    connection.query(sql, params, (err, result) => {
        if (err) {
            console.error('Error updating recipe: ' + err.stack);
            res.status(500).send('Error updating recipe.');
            return;
        }
        console.log('Recipe updated successfully!');
        res.redirect('/myRecipes');
    });
});

router.get('/search', async (req, res) => {
    try {
        const query = req.query.query;
        const sql = 'SELECT * FROM recipes WHERE title LIKE ?';
        connection.query(sql, [`%${query}%`], (err, results) => {
            if (err) {
                console.error('Error retrieving search results: ' + err.stack);
                res.status(500).send('Error retrieving search results.');
                return;
            }

            res.render('searchResults', { searchResults: results });
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('An error occurred while processing your search query.');
    }
});

router.get('/', (req, res) => {
    const sql = 'SELECT * FROM recipes';
    connection.query(sql, (err, results) => {
        if (err) {
            console.error('Error retrieving recipes: ' + err.stack);
            res.status(500).send('Error retrieving recipes.');
            return;
        }

        results.forEach(recipe => {
            recipe.ingredients = recipe.ingredients.split('|');
            recipe.instructions = recipe.instructions.split('|');
        });

        const categories = [
            'Appetizers', 'Breads', 'Soups', 'Pasta & Sauces',
            'Entrées', 'Veggies', 'Cakes', 'Pies', 'Cookies'
        ];
        const categorizedRecipes = {};
        categories.forEach(category => {
            categorizedRecipes[category] = results.filter(recipe => recipe.type === category);
        });

        const showAddRecipeLink = req.session.authenticated;
        const showMyRecipesLink = req.session.authenticated;

        const firstName = req.session.authenticated ? req.session.firstName : '';
        const lastName = req.session.authenticated ? req.session.lastName : '';

        res.render('home', {
            categories,
            categorizedRecipes,
            authenticated: req.session.authenticated,
            userId: req.session.userId,
            showAddRecipeLink,
            showMyRecipesLink,
            firstName,
            lastName
        });
    });
});

router.get('/recipe/:id', (req, res) => {
    const recipeId = req.params.id;

    const sql = 'SELECT * FROM recipes WHERE id = ?';
    connection.query(sql, [recipeId], (err, results) => {
        if (err) {
            console.error('Error retrieving recipe: ' + err.stack);
            res.status(500).send('Error retrieving recipe.');
            return;
        }

        if (results.length === 0) {
            res.status(404).send('Recipe not found.');
            return;
        }

        const recipe = results[0];
        recipe.ingredients = recipe.ingredients.split('|').map(ingredient => `• ${ingredient.trim()}`).join('<br>');
        recipe.instructions = recipe.instructions.split('|');

        const categories = [
            'Appetizers', 'Breads', 'Soups', 'Pasta & Sauces',
            'Entrées', 'Veggies', 'Cakes', 'Pies', 'Cookies'
        ];

        res.render('recipe-details', { recipe, categories });
    });
});

router.get('/category/:category', (req, res) => {
    const category = req.params.category;
    const sql = 'SELECT * FROM recipes WHERE type = ?';
    connection.query(sql, [category], (err, results) => {
        if (err) {
            console.error('Error fetching recipes: ' + err.stack);
            res.status(500).send('Error fetching recipes.');
            return;
        }

        const defaultImageUrl = '/images/default-photo.jpg';
        const modifiedCategory = category.charAt(0).toUpperCase() + category.slice(1);

        const categories = [
            'Appetizers', 'Breads', 'Soups', 'Pasta & Sauces',
            'Entrées', 'Veggies', 'Cakes', 'Pies', 'Cookies'
        ];

        res.render('recipesByCategory', { recipes: results, category: modifiedCategory, defaultImageUrl: defaultImageUrl, categories: categories });
    });
});

router.get('/register', (req, res) => {
    res.render('register', { errorMessage: req.session.errorMessage });
    req.session.errorMessage = undefined;
});

router.post('/register', (req, res) => {
    const { email, password, firstName, lastName } = req.body;
    const emailCheckSql = 'SELECT * FROM cookbook.users WHERE email = ?';
    connection.query(emailCheckSql, [email], (emailErr, emailResults) => {
        if (emailErr) {
            console.error('Error checking email: ' + emailErr.stack);
            res.status(500).send('Error checking email.');
            return;
        }

        if (emailResults.length > 0) {
            req.session.errorMessage = 'Email already registered.';
            res.redirect('/register');
            return;
        }

        const insertSql = 'INSERT INTO cookbook.users (email, password, first_name, last_name) VALUES (?, ?, ?, ?)';
        connection.query(insertSql, [email, password, firstName, lastName], (insertErr, result) => {
            if (insertErr) {
                console.error('Error registering user: ' + insertErr.stack);
                res.status(500).send('Error registering user.');
                return;
            }
            console.log('User registered successfully!');

            req.session.authenticated = true;
            req.session.userId = result.insertId;
            req.session.firstName = firstName;
            req.session.lastName = lastName;

            res.redirect('/');
        });
    });
});

router.get('/login', (req, res) => {
    res.render('login', { errorMessage: req.session.errorMessage });
    req.session.errorMessage = undefined;
});

router.post('/login', (req, res) => {
    const { email, password } = req.body;
    const sql = 'SELECT * FROM cookbook.users WHERE email = ? AND password = ?';
    connection.query(sql, [email, password], (err, results) => {
        if (err) {
            console.error('Error logging in: ' + err.stack);
            res.status(500).send('Error logging in.');
            return;
        }

        if (results.length > 0) {
            req.session.authenticated = true;
            req.session.userId = results[0].id;
            req.session.firstName = results[0].first_name;
            req.session.lastName = results[0].last_name;
            res.redirect('/');
        } else {
            req.session.errorMessage = 'Invalid email or password';
            res.redirect('/');
        }
    });
});

router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session: ' + err.stack);
            res.status(500).send('Error logging out.');
            return;
        }
        res.redirect('/');
    });
});

router.get('/addRecipe', requireAuth, (req, res) => {
    res.render('addRecipe', { authenticated: req.session.authenticated });
});

router.post('/addRecipe', requireAuth, upload.single('photo'), (req, res) => {
    const { title, ingredients, instructions, familySecrets, type, makes } = req.body;
    const image_url = req.file ? '/images/' + req.file.filename : '/images/default-photo.jpg';
    const userId = req.session.userId;
    const sql = 'INSERT INTO recipes (title, ingredients, instructions, family_secrets, type, image_url, userId, makes, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

    const userSql = 'SELECT first_name, last_name FROM cookbook.users WHERE id = ?';
    connection.query(userSql, [userId], (err, userResults) => {
        if (err) {
            console.error('Error fetching user info: ' + err.stack);
            res.status(500).send('Error adding recipe.');
            return;
        }

        const firstName = userResults[0].first_name;
        const lastName = userResults[0].last_name;

        connection.query(sql, [title, ingredients, instructions, familySecrets, type, image_url, userId, makes, `${firstName} ${lastName}`], (err, result) => {
            if (err) {
                console.error('Error adding recipe: ' + err.stack);
                res.status(500).send('Error adding recipe.');
                return;
            }
            console.log('Recipe added successfully!');
            res.redirect('/');
        });
    });
});

router.get('/myRecipes', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const sql = 'SELECT * FROM recipes WHERE userId = ?';
    connection.query(sql, [userId], (err, results) => {
        if (err) {
            console.error('Error retrieving recipes: ' + err.stack);
            res.status(500).send('Error retrieving recipes.');
            return;
        }
        res.render('myRecipes', { recipes: results });
    });
});

// Add more routes as needed...

module.exports = router;
