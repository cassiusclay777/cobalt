import { env } from "../../config.js";
import { resolveRedirectingURL } from "../url.js";

const cachedID = {
    version: '',
    id: ''
}

const extractClientId = (content) => {
    if (!content) {
        return;
    }

    const patterns = [
        /\("client_id=([A-Za-z0-9]{32})"\)/,
        /\bclient_id=([A-Za-z0-9]{32})\b/,
        /client_id["']?\s*[:=]\s*["']([A-Za-z0-9]{32})["']/,
    ];

    for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match?.[1]) {
            return match[1];
        }
    }
}

async function findClientID() {
    try {
        const sc = await fetch('https://soundcloud.com/').then(r => r.text()).catch(() => {});
        if (!sc) {
            return;
        }

        const versionMatch = sc.match(/<script>window\.__sc_version="[0-9]{10}"<\/script>/);
        const scVersion = versionMatch?.[0]?.match(/[0-9]{10}/)?.[0];
        if (!scVersion) {
            return;
        }

        if (cachedID.version === scVersion) {
            return cachedID.id;
        }

        const scripts = sc.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/g);

        let clientid;
        for (let script of scripts) {
            const url = new URL(script[1], "https://soundcloud.com/").toString();

            if (!url?.includes('sndcdn.com/')) {
                continue;
            }

            const scrf = await fetch(url).then(r => r.text()).catch(() => {});
            if (!scrf) {
                continue;
            }

            const id = extractClientId(scrf);
            if (id) {
                clientid = id;
                break;
            }
        }
        cachedID.version = scVersion;
        cachedID.id = clientid;

        return clientid;
    } catch {}
}

const findBestForPreset = (transcodings, preset) => {
    let inferior;
    for (const entry of transcodings) {
        const protocol = entry?.format?.protocol;

        if (entry.snipped || protocol?.includes('encrypted')) {
            continue;
        }

        if (entry?.preset?.startsWith(`${preset}_`)) {
            if (protocol === 'progressive') {
                return entry;
            }

            inferior = entry;
        }
    }

    return inferior;
}

export default async function(obj) {
    let link;

    if (obj.shortLink) {
        obj = {
            ...obj,
            ...await resolveRedirectingURL(
                `https://on.soundcloud.com/${obj.shortLink}`
            )
        }
    }

    if (obj.author && obj.song) {
        link = `https://soundcloud.com/${obj.author}/${obj.song}`;
        if (obj.accessKey) {
            link += `/s-${obj.accessKey}`;
        }
    }

    if (!link && obj.shortLink) return { error: "fetch.short_link" };
    if (!link) return { error: "link.unsupported" };

    let clientId = await findClientID();
    if (!clientId) return { error: "fetch.fail" };

    const resolveTrack = async (id) => {
        const resolveURL = new URL("https://api-v2.soundcloud.com/resolve");
        resolveURL.searchParams.set("url", link);
        resolveURL.searchParams.set("client_id", id);
        return fetch(resolveURL).then(r => r.json()).catch(() => {});
    };

    let json = await resolveTrack(clientId);
    const invalidClientId = json?.errors?.some(e =>
        e?.error_message?.toLowerCase()?.includes("client_id")
    );

    if (invalidClientId) {
        cachedID.version = '';
        cachedID.id = '';
        clientId = await findClientID();
        if (!clientId) return { error: "fetch.fail" };
        json = await resolveTrack(clientId);
    }

    if (!json) return { error: "fetch.fail" };

    if (json.duration > env.durationLimit * 1000) {
        return { error: "content.too_long" };
    }

    if (json.policy === "BLOCK") {
        return { error: "content.region" };
    }

    if (json.policy === "SNIP") {
        return { error: "content.paid" };
    }

    if (!json.media?.transcodings || !json.media?.transcodings.length === 0) {
        return { error: "fetch.empty" };
    }

    let bestAudio = "opus",
        selectedStream = findBestForPreset(json.media.transcodings, "opus");

    const mp3Media = findBestForPreset(json.media.transcodings, "mp3");

    // use mp3 if present if user prefers it or if opus isn't available
    if (mp3Media && (obj.format === "mp3" || !selectedStream)) {
        selectedStream = mp3Media;
        bestAudio = "mp3"
    }

    if (!selectedStream) {
        return { error: "fetch.empty" };
    }

    const fileUrl = new URL(selectedStream.url);
    fileUrl.searchParams.set("client_id", clientId);
    fileUrl.searchParams.set("track_authorization", json.track_authorization);

    const file = await fetch(fileUrl)
                     .then(async r => new URL((await r.json()).url))
                     .catch(() => {});

    if (!file) return { error: "fetch.empty" };

    const artist = json.user?.username?.trim();
    const fileMetadata = {
        title: json.title?.trim(),
        album: json.publisher_metadata?.album_title?.trim(),
        artist,
        album_artist: artist,
        composer: json.publisher_metadata?.writer_composer?.trim(),
        genre: json.genre?.trim(),
        date: json.display_date?.trim().slice(0, 10),
        copyright: json.license?.trim(),
    }

    let cover;
    if (json.artwork_url) {
        const coverUrl = json.artwork_url.replace(/-large/, "-t1080x1080");
        const testCover = await fetch(coverUrl)
            .then(r => r.status === 200)
            .catch(() => {});

        if (testCover) {
            cover = coverUrl;
        }
    }

    return {
        urls: file.toString(),
        cover,
        filenameAttributes: {
            service: "soundcloud",
            id: json.id,
            ...fileMetadata
        },
        bestAudio,
        fileMetadata,
        isHLS: file.pathname.endsWith('.m3u8'),
    }
}
