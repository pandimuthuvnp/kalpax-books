# KalpaX Books

Demo of the KalpaX community book portal: catalogue by topic, availability and borrowers, member login, borrowed list, wishlist and a Grok-powered book assistant.

Open `index.html`, or visit the GitHub Pages link.

Demo login: `Kaxi3520` / `kaxi89929`. The Grok API key is pasted in the chat panel and stays in your browser only; it is never stored in this repo.

## Hosting on Render

Web Service, runtime Node, build command `npm install`, start command `npm start`.
Set the env var `AI_API_KEY` to a Groq key (`gsk_...`) or xAI Grok key (`xai-...`); optional `AI_MODEL`.
The key stays on the server: the page calls `/api/chat` and never sees it.
