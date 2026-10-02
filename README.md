# Vicci & Lexi Karaoke

A karaoke queue for a TV and phones. Run it on a laptop over home Wi-Fi or host it online. Videos play in the official YouTube embedded player.

## Host online for free with Render

1. Create a **private** GitHub repository. Upload the contents of this folder (`server.js`, `package.json`, `public`, and the other non-secret files) to the repository root. **Never upload `youtube-api-key.txt`.** The separate Render ZIP provided with this app already leaves that file out. GitHub's browser upload does not enforce `.gitignore`, so check the upload list before committing.
2. In [Render](https://dashboard.render.com/), choose **New → Web Service**, connect that repository, and select the **Free** instance type. Set **Build Command** to `npm install` and **Start Command** to `npm start`.
3. Under the service's **Environment** settings, add `YOUTUBE_API_KEY` with your YouTube Data API key as its value. Save and redeploy. Render supplies `PORT` and `RENDER_EXTERNAL_URL` automatically; the app uses the latter for its phone QR code.
4. After deployment, open the service's **Logs** and copy the complete line beginning **TV:**. Open that link on the TV or another laptop. Its `?host=...` part enables the TV's host controls, so keep that link private. Singers scan the QR code shown on the TV.

The URL is public, so the TV and phones can be on different networks. Keep the TV page open during a party; it sends occasional requests to keep the free service awake. An idle free service can take about a minute to wake up. Render can restart free services, which clears this app's in-memory queue and creates a new party code and TV host link; copy the new TV link from Logs and have singers scan the new QR code. Anyone with the singer link can join and use the phone controls. Online hosting does not remove YouTube ads or fix videos unavailable in YouTube's embedded player.

## Start

1. Double-click `start.bat` on a Windows computer with Node.js installed (Node 18 or later).
2. Open the printed **TV** address in the TV browser, or connect the computer to the TV with HDMI and open it there.
3. Scan the QR code on the TV with each singer's phone. Everyone must be on the same Wi-Fi.
4. Enter a singer name. Once YouTube search is set up below, search by title/artist and tap **+ Queue**. **Sing next** puts a song at the front of the waiting list. Until then, paste a YouTube link.

On the phone, **My songs** saves favorites and recently queued tracks on that phone. The lineup page has Play/Pause, Next, restart, 10-second skip buttons, and cheer buttons. The TV shows cheers and a short countdown between songs.

The computer running the server must stay on. If Windows Firewall asks, allow Node.js on **private networks**. If the TV cannot open the address, check that the TV and computer are on the same network and that your router allows devices to talk to each other.

## Move the server to another laptop

Copy the complete `karaoke-party` folder to the other laptop, or transfer `Vicci & Lexi Karaoke.zip` and extract it there. Install Node.js on that laptop, open the extracted folder, and run `start.bat` on Windows (or `node server.js` in a terminal on macOS/Linux). The new laptop prints its own TV address and makes a new party code. Open that new TV address and have everyone scan its new QR code. Keep the new laptop awake while singing. The old queue does not transfer.

## Search more songs on YouTube

The older site's preloaded video IDs could not play in the official YouTube embed because their owners disabled embedding. This version uses YouTube search to return videos marked as embeddable. To enable it:

1. In [Google Cloud Console](https://console.cloud.google.com/), create or choose a project.
2. Under **APIs & Services → Library**, enable **YouTube Data API v3**.
3. Under **APIs & Services → Credentials**, create an **API key**. Restrict the key to the YouTube Data API v3.
4. Open `youtube-api-key.txt` in the karaoke app folder, paste only the key, and save. Refresh the phone page. No server restart is needed.

You can instead start the server with the `YOUTUBE_API_KEY` environment variable. In PowerShell:

```powershell
$env:YOUTUBE_API_KEY = 'YOUR_KEY'
node server.js
```

The online search feature uses YouTube's official API and is subject to its quota. Keep the key private; it is read by the server and not sent to singers' phones.

## Notes

- YouTube may show ads in embedded videos. This app cannot remove or skip them.
- Some creators disable embedding for their videos; choose another video if one will not play.
- If the TV player rejects a queued video, it searches for another karaoke version of the same song and tries a few alternatives automatically. This needs the YouTube API key and uses one search request. If none works, choose another result on the phone.
- A browser may require one tap on **Start singing** before it allows sound. Later queued videos normally advance automatically, but TV browsers differ.
- The queue is held in memory and clears when the server restarts. A new party code is made each time.
- Anyone with the party link on your local network can add songs. Run this only on a trusted home network.
- The old site's preloaded song videos were not copied into the active catalog because YouTube blocks them in ordinary embeds. Search results use YouTube's `videoEmbeddable=true` filter, though an individual video may still become unavailable later.
- The older site's phone microphone and pitch controls are not included. Browser microphone access on a local HTTP address is restricted, and YouTube's embedded player does not expose its audio for pitch shifting.
- The older site's host approval gate, AI DJ, and alternate video streaming fallback are not included. This local version uses the official YouTube embedded player and admits anyone with the room link on the trusted home network.

QR code generation uses [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), MIT licensed, by Kazuhiko Arase.
