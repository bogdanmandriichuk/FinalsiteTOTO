import express from 'express';
import Database from 'better-sqlite3';
import { Telegraf } from 'telegraf';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'posts.db');
const db = new Database(dbPath);

// Create table if it doesn't exist
db.exec("CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, photo_paths TEXT, caption TEXT)");

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

app.use(express.json());
app.use('/photos', express.static(path.join(__dirname, 'photos')));

// Endpoints for working with posts
app.get('/posts', (req, res) => {
    try {
        const rows = db.prepare("SELECT * FROM posts").all();
        res.json(rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post('/newpost', async (req, res) => {
    const { photo_paths, caption } = req.body;

    if (!photo_paths || !caption) {
        return res.status(400).send('Потрібно надіслати photo_paths та caption');
    }

    try {
        const savedPhotoPaths = [];
        for (const photo_path of photo_paths) {
            const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${photo_path}`;
            const response = await fetch(photoUrl);
            if (response.ok) {
                const buffer = Buffer.from(await response.arrayBuffer());

                const photoFileName = `${Date.now()}_${path.basename(photo_path)}`;
                const photoFilePath = path.join(__dirname, 'photos', photoFileName);
                await fs.writeFile(photoFilePath, buffer);

                savedPhotoPaths.push(photoFileName);
            } else {
                console.error(`Помилка завантаження фото ${photo_path}:`, response.statusText);
            }
        }

        if (savedPhotoPaths.length > 0) {
            db.prepare("INSERT INTO posts (photo_paths, caption) VALUES (?, ?)")
                .run(JSON.stringify(savedPhotoPaths), caption);
            console.log("Новий пост збережено:", { photoPaths: savedPhotoPaths, caption });
            res.status(200).send('Пост успішно збережено у базі даних');
        } else {
            res.status(400).send('Немає дійсних фото для збереження');
        }
    } catch (error) {
        console.error("Помилка обробки фотографій:", error);
        res.status(500).send('Помилка при збереженні постів у базі даних');
    }
});

app.delete('/posts/:id', (req, res) => {
    const postId = req.params.id;

    try {
        const info = db.prepare("DELETE FROM posts WHERE id = ?").run(postId);
        if (info.changes === 0) {
            res.status(404).send('Пост не знайдено');
        } else {
            console.log(`Пост з ID ${postId} видалено`);
            res.status(200).send('Пост успішно видалено');
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Помилка при видаленні посту');
    }
});

app.get('/photos/:photoId', (req, res) => {
    const { photoId } = req.params;
    const photoPath = path.join(__dirname, 'photos', photoId);

    fs.access(photoPath)
        .then(() => res.sendFile(photoPath))
        .catch(err => {
            console.error(err);
            res.status(404).send('Зображення не знайдено');
        });
});

// Endpoints for working with fonts
const googleFontsApiUrl = `https://www.googleapis.com/webfonts/v1/webfonts?key=${process.env.GOOGLE_FONTS_API_KEY}`;

app.get('/fonts', async (req, res) => {
    try {
        const response = await fetch(googleFontsApiUrl);
        const data = await response.json();

        const fonts = data.items.map(font => font.family);
        res.json(fonts);
    } catch (error) {
        console.error('Помилка завантаження шрифтів з Google Fonts:', error);
        res.status(500).send('Не вдалося завантажити шрифти');
    }
});

// Handle appointment requests
app.post('/appointment', (req, res) => {
    const { name, phone } = req.body;

    if (!name || !phone) {
        return res.status(400).send('Потрібно надіслати ім\'я та номер телефону');
    }

    bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, `Нова заявка на сеанс:\nІм'я: ${name}\nНомер телефону: ${phone}`)
        .then(() => res.status(200).send('Заявка успішно відправлена'))
        .catch((error) => {
            console.error('Помилка відправки повідомлення:', error);
            res.status(500).send('Помилка при відправці заявки');
        });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Сервер працює на порті ${PORT}`);
});

// Telegram Bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Dictionary to store temporary data about media groups
const mediaGroupStorage = {};

// Function to save media group
async function saveMediaGroup(ctx, mediaGroupId) {
    const mediaGroup = mediaGroupStorage[mediaGroupId];
    if (!mediaGroup) {
        console.error(`Media group ${mediaGroupId} не знайдено.`);
        return;
    }

    const { photoPaths, caption } = mediaGroup;

    db.prepare("INSERT INTO posts (photo_paths, caption) VALUES (?, ?)")
        .run(JSON.stringify(photoPaths), caption);
    console.log("Новий пост збережено:", { photoPaths, caption });
    ctx.reply('Фото та текст успішно завантажено і збережено в базі даних');

    // Remove data from the dictionary after saving
    delete mediaGroupStorage[mediaGroupId];
}

bot.on('photo', async (ctx) => {
    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const caption = ctx.message.caption || '';
    const mediaGroupId = ctx.message.media_group_id;

    try {
        const photo = await ctx.telegram.getFile(photoId);
        const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${photo.file_path}`;
        const response = await fetch(photoUrl);
        if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer());

            const photoFileName = `${Date.now()}_${photo.file_unique_id}.jpg`;
            const photoFilePath = path.join(__dirname, 'photos', photoFileName);
            await fs.writeFile(photoFilePath, buffer);

            if (mediaGroupId) {
                console.log(`Received photo for media group ${mediaGroupId}`);

                if (!mediaGroupStorage[mediaGroupId]) {
                    mediaGroupStorage[mediaGroupId] = { photoPaths: [], caption, count: 0 };
                }
                mediaGroupStorage[mediaGroupId].photoPaths.push(photoFileName);
                mediaGroupStorage[mediaGroupId].count++;

                // Save the media group after a delay to ensure all photos are received
                setTimeout(() => {
                    if (mediaGroupStorage[mediaGroupId] && mediaGroupStorage[mediaGroupId].count > 1) {
                        console.log(`Saving media group ${mediaGroupId} after delay`);
                        saveMediaGroup(ctx, mediaGroupId);
                    }
                }, 2000);
            } else {
                db.prepare("INSERT INTO posts (photo_paths, caption) VALUES (?, ?)")
                    .run(JSON.stringify([photoFileName]), caption);
                console.log("Новий пост збережено:", { photoPaths: [photoFileName], caption });
                ctx.reply('Фото та текст успішно завантажено і збережено в базі даних');
            }
        } else {
            console.error(`Помилка завантаження фото ${photoId}:`, response.statusText);
            ctx.reply('Помилка при завантаженні фотографії');
        }
    } catch (error) {
        console.error("Помилка обробки фотографії:", error);
        ctx.reply('Помилка при обробці фотографії');
    }
});

bot.command('deletepost', (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length !== 2) {
        return ctx.reply('Використання: /deletepost [ID]');
    }

    const postId = args[1];

    try {
        const info = db.prepare("DELETE FROM posts WHERE id = ?").run(postId);
        if (info.changes === 0) {
            ctx.reply('Пост не знайдено');
        } else {
            console.log(`Пост з ID ${postId} видалено`);
            ctx.reply('Пост успішно видалено');
        }
    } catch (err) {
        console.error(err.message);
        ctx.reply('Помилка при видаленні посту');
    }
});

bot.on('text', (ctx) => {
    ctx.reply('Будь ласка, надішліть фотографію з підписом.');
});

bot.launch();
