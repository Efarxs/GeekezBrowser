const https = require('https');

function normalizeReleaseVersion(rawTag) {
    return String(rawTag || '').trim().replace(/^v/i, '');
}

function extractReleaseTagFromUrl(url) {
    const match = String(url || '').match(/\/releases\/tag\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : '';
}

function extractErrorMessage(body) {
    if (!body) return '';

    try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed.message === 'string') {
            return parsed.message;
        }
    } catch (error) {
        // Ignore parse failures and fall back to raw body text below.
    }

    const text = String(body || '').trim();
    return text ? text.slice(0, 200) : '';
}

function requestUrl(url, { headers = {}, timeoutMs = 10000, maxRedirects = 5 } = {}, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers }, (res) => {
            const statusCode = Number(res.statusCode || 0);
            const location = res.headers.location;

            if (statusCode >= 300 && statusCode < 400 && location) {
                res.resume();

                if (redirectCount >= maxRedirects) {
                    reject(new Error(`Too many redirects while requesting ${url}`));
                    return;
                }

                const nextUrl = new URL(location, url).toString();
                requestUrl(nextUrl, { headers, timeoutMs, maxRedirects }, redirectCount + 1)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                resolve({
                    statusCode,
                    headers: res.headers,
                    body,
                    finalUrl: url
                });
            });
        });

        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('Timeout'));
        });
    });
}

function parseJsonResponse(response, url) {
    const statusCode = Number(response?.statusCode || 0);
    if (statusCode < 200 || statusCode >= 300) {
        const detail = extractErrorMessage(response?.body);
        throw new Error(`Request to ${url} failed with HTTP ${statusCode}${detail ? `: ${detail}` : ''}`);
    }

    try {
        return JSON.parse(response?.body || '{}');
    } catch (error) {
        throw new Error(`Invalid JSON response from ${url}`);
    }
}

async function fetchLatestGitHubReleaseInfo({ owner, repo, currentVersion = 'unknown', timeoutMs = 10000, requestImpl = requestUrl } = {}) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const latestPageUrl = `https://github.com/${owner}/${repo}/releases/latest`;
    const userAgent = `GeekezBrowser/${currentVersion}`;

    let apiError = null;
    try {
        const apiResponse = await requestImpl(apiUrl, {
            headers: {
                'User-Agent': userAgent,
                'Accept': 'application/vnd.github+json'
            },
            timeoutMs,
            maxRedirects: 5
        });
        const data = parseJsonResponse(apiResponse, apiUrl);
        const latestVersion = normalizeReleaseVersion(data.tag_name);
        if (!latestVersion) {
            throw new Error('Release metadata missing tag_name');
        }

        return {
            latestVersion,
            tagName: String(data.tag_name || ''),
            downloadUrl: data.html_url || `https://github.com/${owner}/${repo}/releases/tag/${data.tag_name}`,
            notes: data.body || '',
            source: 'api'
        };
    } catch (error) {
        apiError = error;
    }

    const pageResponse = await requestImpl(latestPageUrl, {
        headers: { 'User-Agent': userAgent },
        timeoutMs,
        maxRedirects: 5
    });
    const finalUrl = pageResponse?.finalUrl || latestPageUrl;
    const tagName = extractReleaseTagFromUrl(finalUrl);
    const latestVersion = normalizeReleaseVersion(tagName);

    if (!latestVersion) {
        throw apiError || new Error('Release page did not resolve to a tagged release URL');
    }

    return {
        latestVersion,
        tagName,
        downloadUrl: finalUrl,
        notes: '',
        source: 'release-page',
        apiError: apiError?.message || ''
    };
}

module.exports = {
    extractReleaseTagFromUrl,
    fetchLatestGitHubReleaseInfo,
    normalizeReleaseVersion,
    requestUrl
};
