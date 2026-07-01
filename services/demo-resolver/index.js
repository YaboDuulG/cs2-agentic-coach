const express = require('express');
const cors = require('cors');
const SteamUser = require('steam-user');
const GlobalOffensive = require('globaloffensive');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const client = new SteamUser();
const csgo = new GlobalOffensive(client);

let isReady = false;

const logOnOptions = {
    accountName: process.env.STEAM_USERNAME,
    password: process.env.STEAM_PASSWORD,
};

if (process.env.STEAM_GUARD_CODE) {
    logOnOptions.authCode = process.env.STEAM_GUARD_CODE;
    logOnOptions.twoFactorCode = process.env.STEAM_GUARD_CODE;
}

if (process.env.STEAM_USERNAME && process.env.STEAM_PASSWORD) {
    console.log(`Logging into Steam as ${process.env.STEAM_USERNAME}...`);
    client.logOn(logOnOptions);
} else {
    console.warn("STEAM_USERNAME and STEAM_PASSWORD environment variables are required.");
}

client.on('loggedOn', () => {
    console.log('Logged into Steam successfully!');
    client.setPersona(SteamUser.EPersonaState.Online);
    client.gamesPlayed([730]);
});

client.on('error', (err) => {
    console.error('Steam login error:', err);
});

let steamGuardCallback = null;

client.on('steamGuard', (domain, callback, lastCodeWrong) => {
    console.log("SteamGuard code required. Provide via POST /auth/steamguard");
    steamGuardCallback = callback;
});

csgo.on('connectedToGC', () => {
    console.log('Connected to CS2 Game Coordinator!');
    isReady = true;
});

csgo.on('disconnectedFromGC', (reason) => {
    console.log('Disconnected from GC:', reason);
    isReady = false;
});

app.post('/auth/steamguard', (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code is required' });
    
    if (steamGuardCallback) {
        steamGuardCallback(code);
        steamGuardCallback = null;
        res.json({ message: 'SteamGuard code applied!' });
    } else {
        res.status(400).json({ error: 'No pending SteamGuard request' });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', steam_ready: isReady });
});

app.get('/resolve/steam/:sharecode', (req, res) => {
    const sharecode = req.params.sharecode;
    
    if (!isReady) {
        return res.status(503).json({ error: 'Not connected to CS2 GC' });
    }

    csgo.requestGame(sharecode);
    
    const onMatchList = (matches) => {
        if (matches && matches.length > 0) {
            const matchStr = JSON.stringify(matches[0]);
            const urlMatch = matchStr.match(/http[s]?:\/\/[^\s"'\]]+\.dem\.bz2/);
            
            csgo.removeListener('matchList', onMatchList);
            
            if (urlMatch) {
                return res.json({ url: urlMatch[0] });
            } else {
                return res.status(404).json({ error: 'Could not find demo URL in GC response', data: matches[0] });
            }
        }
    };
    
    csgo.on('matchList', onMatchList);
    
    setTimeout(() => {
        csgo.removeListener('matchList', onMatchList);
        if (!res.headersSent) {
            res.status(504).json({ error: 'Timeout waiting for GC response' });
        }
    }, 10000);
});

app.get('/resolve/faceit/:match_id', async (req, res) => {
    const matchId = req.params.match_id;
    try {
        const response = await axios.get(`https://open.faceit.com/data/v4/matches/${matchId}`, {
            headers: {
                Authorization: `Bearer ${process.env.FACEIT_API_KEY}`
            }
        });
        const demoUrls = response.data.demo_url;
        if (demoUrls && demoUrls.length > 0) {
            res.json({ url: demoUrls[0] });
        } else {
            res.status(404).json({ error: 'No demo URLs found for this match' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
    console.log(`demo-resolver listening on port ${PORT}`);
});
