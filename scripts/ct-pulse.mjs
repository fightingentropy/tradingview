#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const taskDirectory = path.resolve(scriptDirectory, "..");

const config = {
  listId: "1933193197817135501",
  hours: 24,
  ctCount: 400,
  followingCount: 400,
  homeCount: 100,
  authorCap: 3,
  balancedLimit: 120,
  homeAuthorCap: 2,
  homeLimit: 60,
  outputDirectory: path.join(taskDirectory, ".ct-pulse"),
};

function usage() {
  return `Usage: node ct-pulse.mjs [options]

Options:
  --list-id ID            X list ID or URL (default: ${config.listId})
  --hours N               Recency window for CT and Following (default: ${config.hours})
  --ct-count N            CT list posts to request (default: ${config.ctCount})
  --following-count N     Following posts to request (default: ${config.followingCount})
  --home-count N          For You posts to request (default: ${config.homeCount})
  --author-cap N          Max stories per author in balanced view (default: ${config.authorCap})
  --output-dir PATH       Output directory (default: <Stocks task>/.ct-pulse)
  --help                  Show this help
`;
}

function positiveInteger(value, option) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} requires a positive integer`);
  }
  return parsed;
}

function parseArguments(args) {
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];

    if (option === "--help") {
      process.stdout.write(usage());
      process.exit(0);
    }

    if (!value) {
      throw new Error(`Missing value for ${option}`);
    }

    if (option === "--list-id") config.listId = value;
    else if (option === "--hours") config.hours = positiveInteger(value, option);
    else if (option === "--ct-count") config.ctCount = positiveInteger(value, option);
    else if (option === "--following-count") {
      config.followingCount = positiveInteger(value, option);
    } else if (option === "--home-count") {
      config.homeCount = positiveInteger(value, option);
    } else if (option === "--author-cap") {
      config.authorCap = positiveInteger(value, option);
    } else if (option === "--output-dir") {
      config.outputDirectory = path.resolve(value);
    } else {
      throw new Error(`Unknown option: ${option}`);
    }

    index += 1;
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed with exit ${code}: ${stderr.trim()}`,
          ),
        );
        return;
      }
      resolve(stdout);
    });
  });
}

function parseBirdJson(raw, source) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("expected a JSON array");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Could not parse ${source} output: ${error.message}`);
  }
}

function xUrl(username, id) {
  if (!username || !id) return null;
  return `https://x.com/${username}/status/${id}`;
}

function asDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function engagement(post) {
  return (
    Number(post.likeCount || 0) +
    Number(post.retweetCount || 0) * 2 +
    Number(post.replyCount || 0)
  );
}

function normalizePost(post, surface) {
  const retweeted = post.retweetedTweet || null;
  const quoted = post.quotedTweet || null;
  const underlying = retweeted || quoted || null;
  const storyId = String(underlying?.id || post.id);
  const author = post.author || {};
  const underlyingAuthor = underlying?.author || null;

  return {
    ...post,
    id: String(post.id),
    surface,
    createdDate: asDate(post.createdAt),
    isRetweet: Boolean(retweeted) || String(post.text || "").startsWith("RT @"),
    isQuote: Boolean(quoted),
    storyId,
    url: xUrl(author.username, post.id),
    underlying: underlying
      ? {
          ...underlying,
          id: String(underlying.id),
          url: xUrl(underlyingAuthor?.username, underlying.id),
        }
      : null,
    engagement: engagement(post),
  };
}

function normalizedMatchText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[.…]+$/u, "")
    .trim()
    .toLowerCase();
}

function resolveCompactRetweets(posts) {
  const originalsByAuthor = new Map();

  function addOriginal(original) {
    const author = original.author?.username?.toLowerCase();
    if (!author || !original.id || !original.text) return;
    if (!originalsByAuthor.has(author)) originalsByAuthor.set(author, []);
    if (
      originalsByAuthor
        .get(author)
        .some((candidate) => candidate.id === String(original.id))
    ) {
      return;
    }
    originalsByAuthor.get(author).push({
      ...original,
      id: String(original.id),
      url: original.url || xUrl(original.author?.username, original.id),
    });
  }

  for (const post of posts) {
    if (!post.isRetweet) addOriginal(post);
    if (post.underlying) addOriginal(post.underlying);
  }

  for (const post of posts) {
    if (!post.isRetweet || post.underlying) continue;
    const match = String(post.text || "").match(/^RT @([A-Za-z0-9_]+):\s*([\s\S]+)$/);
    if (!match) continue;

    const [, username, rawBody] = match;
    const body = normalizedMatchText(rawBody);
    if (body.length < 28) continue;

    const candidates = originalsByAuthor.get(username.toLowerCase()) || [];
    const original = candidates.find((candidate) => {
      const candidateText = normalizedMatchText(candidate.text);
      return candidateText === body || candidateText.startsWith(body);
    });
    if (!original) continue;

    post.storyId = original.id;
    post.underlying = {
      id: original.id,
      text: original.text,
      createdAt: original.createdAt,
      replyCount: original.replyCount,
      retweetCount: original.retweetCount,
      likeCount: original.likeCount,
      author: original.author,
      url: original.url,
    };
  }
}

function withinWindow(post, cutoff) {
  return post.createdDate && post.createdDate >= cutoff;
}

function countBy(items, keyFunction) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFunction(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function metrics(posts, cutoff = null) {
  const current = cutoff ? posts.filter((post) => withinWindow(post, cutoff)) : posts;
  const authors = countBy(current, (post) => post.author?.username);
  const topTwo = authors.slice(0, 2).reduce((sum, [, count]) => sum + count, 0);

  return {
    requestedAndReturned: posts.length,
    inWindow: current.length,
    uniqueAuthors: new Set(
      current.map((post) => post.author?.username).filter(Boolean),
    ).size,
    retweets: current.filter((post) => post.isRetweet).length,
    quotePosts: current.filter((post) => post.isQuote).length,
    topTwoShare: current.length ? topTwo / current.length : 0,
    topAuthors: authors.slice(0, 10).map(([author, count]) => ({
      author,
      count,
      share: current.length ? count / current.length : 0,
    })),
  };
}

function representativeScore(post) {
  const isUnderlyingOriginal = post.id === post.storyId ? 1 : 0;
  const hasSubstantiveCommentary =
    post.isQuote && String(post.text || "").trim().length >= 80 ? 1 : 0;
  return (
    isUnderlyingOriginal * 1_000_000_000 +
    hasSubstantiveCommentary * 100_000_000 +
    Math.min(post.engagement, 10_000_000)
  );
}

function groupStories(posts) {
  const groups = new Map();
  for (const post of posts) {
    if (!groups.has(post.storyId)) groups.set(post.storyId, []);
    groups.get(post.storyId).push(post);
  }

  return [...groups.entries()].map(([storyId, items]) => {
    const sortedByRepresentative = [...items].sort(
      (a, b) => representativeScore(b) - representativeScore(a),
    );
    const representative = sortedByRepresentative[0];
    const directOriginal = items.find((item) => item.id === storyId) || null;
    const embeddedOriginal = items.find((item) => item.underlying)?.underlying || null;
    const primary = directOriginal || embeddedOriginal || representative;
    const primaryAuthor = primary.author || {};
    const latestDate = items.reduce((latest, item) => {
      if (!item.createdDate) return latest;
      return !latest || item.createdDate > latest ? item.createdDate : latest;
    }, null);

    return {
      storyId,
      author: {
        username: primaryAuthor.username || representative.author?.username || "unknown",
        name: primaryAuthor.name || representative.author?.name || "",
      },
      text: String(primary.text || representative.text || ""),
      createdAt: primary.createdAt || representative.createdAt,
      latestSeenAt: latestDate?.toISOString() || null,
      url:
        primary.url ||
        xUrl(primaryAuthor.username, storyId) ||
        representative.url,
      representative: {
        id: representative.id,
        author: representative.author,
        text: String(representative.text || ""),
        url: representative.url,
      },
      surfaces: [...new Set(items.map((item) => item.surface))].sort(),
      appearances: items.length,
      amplifiers: [
        ...new Set(
          items
            .filter((item) => item.id !== storyId)
            .map((item) => item.author?.username)
            .filter(Boolean),
        ),
      ],
      maxEngagement: Math.max(...items.map((item) => item.engagement)),
      isRetweetOnly: items.every((item) => item.isRetweet),
      hasQuoteCommentary: items.some((item) => item.isQuote),
    };
  });
}

function capByAuthor(stories, authorCap, limit) {
  const counts = new Map();
  const selected = [];

  for (const story of stories) {
    const author = story.author.username;
    const count = counts.get(author) || 0;
    if (count >= authorCap) continue;
    counts.set(author, count + 1);
    selected.push(story);
    if (selected.length >= limit) break;
  }

  return selected;
}

function balancedAcrossSurfaces(stories, authorCap, limit) {
  const quotas = {
    crossSurface: Math.floor(limit * 0.25),
    ctOnly: Math.floor(limit * 0.25),
    followingOnly: limit - Math.floor(limit * 0.5),
  };
  const buckets = {
    crossSurface: stories.filter((story) => story.surfaces.length >= 2),
    ctOnly: stories.filter(
      (story) =>
        story.surfaces.length === 1 && story.surfaces.includes("ct"),
    ),
    followingOnly: stories.filter(
      (story) =>
        story.surfaces.length === 1 && story.surfaces.includes("following"),
    ),
  };
  const selected = [];
  const selectedIds = new Set();
  const authorCounts = new Map();

  function addFrom(bucket, quota) {
    let added = 0;
    for (const story of bucket) {
      if (added >= quota || selected.length >= limit) break;
      const author = story.author.username;
      const authorCount = authorCounts.get(author) || 0;
      if (selectedIds.has(story.storyId) || authorCount >= authorCap) continue;
      selected.push(story);
      selectedIds.add(story.storyId);
      authorCounts.set(author, authorCount + 1);
      added += 1;
    }
    return added;
  }

  const crossSurfaceAdded = addFrom(
    buckets.crossSurface,
    quotas.crossSurface,
  );
  addFrom(
    buckets.ctOnly,
    quotas.ctOnly + (quotas.crossSurface - crossSurfaceAdded),
  );
  addFrom(buckets.followingOnly, quotas.followingOnly);
  addFrom(stories, limit - selected.length);

  return selected.sort(
    (a, b) =>
      new Date(b.latestSeenAt || 0).getTime() -
      new Date(a.latestSeenAt || 0).getTime(),
  );
}

function signalText(story) {
  const options = [story.text, story.representative?.text]
    .map((value) => String(value || "").trim())
    .sort((a, b) => b.length - a.length);
  return options[0] || "";
}

function isLowSignalStory(story) {
  const text = signalText(story);
  const withoutLinksAndMentions = text
    .replace(/https?:\/\/\S+|https:\/\/t\.co\/\S+/gi, " ")
    .replace(/@[A-Za-z0-9_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words =
    withoutLinksAndMentions.match(/[\p{L}\p{N}$][\p{L}\p{N}'’$-]*/gu) || [];
  const genericReaction =
    /^(gm|gn|yes|no|wow|nice|nice one|interesting|amazing|unbelievable|makes you think|thank you|thanks|lol|lmao|lmfao|oh no|same|this|true|correct|agreed|based)[.!?…\s]*$/i;

  if (genericReaction.test(withoutLinksAndMentions)) return true;
  if (withoutLinksAndMentions.length < 28) return true;
  if (words.length < 6) return true;
  if (withoutLinksAndMentions.length < 60 && topicTags(text).length === 0) {
    return true;
  }
  return false;
}

const patterns = {
  ai: /\b(ai|agent|agents|anthropic|claude|codex|gpt|grok|llm|model|openai|robotics?)\b/i,
  crypto:
    /\b(bitcoin|btc|crypto|defi|ethereum|eth|hyperliquid|memecoin|perps?|solana|token|web3)\b|\$[A-Z][A-Z0-9_]{1,9}\b/i,
  markets:
    /\b(aapl|bond|bonds|earnings|equities|equity|fed|fund|ipo|kospi|market|markets|nasdaq|nvidia|rates|retail investors|stocks?|treasury|yield)\b/i,
  politics:
    /\b(congress|election|government|iran|israel|netanyahu|president|senate|trump|white house)\b/i,
  technology:
    /\b(apple|developer|open source|software|spacex|starlink|tesla|waymo)\b/i,
};

function topicTags(text) {
  return Object.entries(patterns)
    .filter(([, pattern]) => pattern.test(text))
    .map(([topic]) => topic);
}

function promotionHint(story) {
  const text = `${story.text} ${story.representative.text}`;
  const explicit =
    /\b(airdrop|claim now|drop your (?:sol|wallet)|giveaway|presale|referral|solana:[A-Za-z0-9]+|ethereum:0x[a-fA-F0-9]+)\b/i;
  const tokenCall =
    /\$[A-Z][A-Z0-9_]{1,9}\b/.test(text) &&
    /\b(ape|bag|buy|community|launch|long|mcap|moon|pump|send|shill|target|trenches)\b/i.test(
      text,
    );
  return explicit.test(text) || tokenCall;
}

function tickerCounts(stories) {
  const tickerToStories = new Map();
  const tickerToAuthors = new Map();

  for (const story of stories) {
    const tickers = new Set(
      (story.text.match(/\$[A-Z][A-Z0-9_]{1,9}\b/g) || []).map((ticker) =>
        ticker.toUpperCase(),
      ),
    );
    for (const ticker of tickers) {
      tickerToStories.set(ticker, (tickerToStories.get(ticker) || 0) + 1);
      if (!tickerToAuthors.has(ticker)) tickerToAuthors.set(ticker, new Set());
      tickerToAuthors.get(ticker).add(story.author.username);
    }
  }

  return [...tickerToStories.entries()]
    .map(([ticker, count]) => ({
      ticker,
      count,
      uniqueAuthors: tickerToAuthors.get(ticker)?.size || 0,
    }))
    .sort((a, b) => b.count - a.count || b.uniqueAuthors - a.uniqueAuthors)
    .slice(0, 20);
}

function topicCounts(stories) {
  const counts = new Map();
  for (const story of stories) {
    const tags = topicTags(story.text);
    for (const tag of tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([topic, count]) => ({ topic, count }));
}

function exactOverlap(left, right) {
  const rightIds = new Set(right.map((post) => post.id));
  return new Set(left.filter((post) => rightIds.has(post.id)).map((post) => post.id))
    .size;
}

function storyOverlap(left, right) {
  const rightIds = new Set(right.map((post) => post.storyId));
  return new Set(
    left.filter((post) => rightIds.has(post.storyId)).map((post) => post.storyId),
  ).size;
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function cleanText(value, length = 260) {
  const compact = String(value || "")
    .replace(/\s+/g, " ")
    .replaceAll("|", "\\|")
    .trim();
  return compact.length <= length ? compact : `${compact.slice(0, length - 1)}…`;
}

function sourceLabel(surfaces) {
  return surfaces
    .map((surface) => {
      if (surface === "ct") return "CT";
      if (surface === "following") return "Following";
      return "For You";
    })
    .join(" + ");
}

function storyLine(story, generatedAt, showFreshness = false) {
  const link = story.url
    ? `[@${story.author.username}](${story.url})`
    : `@${story.author.username}`;
  const tags = topicTags(story.text);
  const metadata = [
    sourceLabel(story.surfaces),
    story.appearances > 1 ? `${story.appearances} appearances` : null,
    tags.length ? tags.join(", ") : null,
  ].filter(Boolean);
  const createdDate = asDate(story.createdAt);
  if (
    showFreshness &&
    createdDate &&
    generatedAt.getTime() - createdDate.getTime() > 24 * 60 * 60 * 1000
  ) {
    metadata.push("resurfaced");
  }
  return `- ${link}: ${cleanText(story.text)} _(${metadata.join("; ")})_`;
}

function markdownReport(data) {
  const generatedAt = new Date(data.generatedAt);
  const lines = [
    "# CT pulse source pack",
    "",
    `Generated ${generatedAt.toLocaleString("en-GB", {
      timeZone: "Europe/London",
      dateStyle: "medium",
      timeStyle: "short",
    })} using ${data.birdVersion}.`,
    "",
    "This is an evidence pack, not an automated investment conclusion. The balanced section caps repeated authors while diagnostics preserve their raw share.",
    "",
    "## Source diagnostics",
    "",
    "| Surface | Returned | In window | Authors | Retweets | Top-two author share |",
    "|---|---:|---:|---:|---:|---:|",
  ];

  for (const [key, label] of [
    ["ct", "CT list"],
    ["following", "Following"],
    ["forYou", "For You"],
  ]) {
    const item = data.diagnostics.surfaces[key];
    lines.push(
      `| ${label} | ${item.requestedAndReturned} | ${item.inWindow} | ${item.uniqueAuthors} | ${item.retweets} | ${pct(item.topTwoShare)} |`,
    );
  }

  lines.push(
    "",
    `CT and Following use a ${data.config.hours}-hour window. For You is intentionally left as the algorithm returned it; ${data.diagnostics.forYouFreshCount}/${data.diagnostics.surfaces.forYou.requestedAndReturned} posts were under 24 hours old.`,
    "",
    "### Cross-surface overlap",
    "",
    "| Pair | Exact posts | Underlying stories |",
    "|---|---:|---:|",
    `| CT ↔ Following | ${data.diagnostics.overlap.ctFollowing.exact} | ${data.diagnostics.overlap.ctFollowing.stories} |`,
    `| CT ↔ For You | ${data.diagnostics.overlap.ctForYou.exact} | ${data.diagnostics.overlap.ctForYou.stories} |`,
    `| Following ↔ For You | ${data.diagnostics.overlap.followingForYou.exact} | ${data.diagnostics.overlap.followingForYou.stories} |`,
    "",
    "### Most prolific authors",
    "",
  );

  for (const [surface, label] of [
    ["ct", "CT list"],
    ["following", "Following"],
    ["forYou", "For You"],
  ]) {
    const authors = data.diagnostics.surfaces[surface].topAuthors
      .slice(0, 6)
      .map((item) => `@${item.author} ${item.count} (${pct(item.share)})`)
      .join(", ");
    lines.push(`- **${label}:** ${authors}`);
  }

  lines.push("", "### Heuristic topic and ticker volume", "");
  lines.push(
    `- **Topics:** ${data.diagnostics.topicCounts
      .map((item) => `${item.topic} ${item.count}`)
      .join(", ") || "none detected"}`,
  );
  lines.push(
    `- **Tickers:** ${data.diagnostics.tickerCounts
      .map(
        (item) =>
          `${item.ticker} ${item.count} posts/${item.uniqueAuthors} authors`,
      )
      .join(", ") || "none detected"}`,
  );

  lines.push("", "## Cross-surface visibility", "");
  lines.push(
    "These stories appeared on more than one surface. That indicates distribution breadth, not independent agreement.",
    "",
  );
  if (data.crossSurface.length === 0) {
    lines.push("- No overlapping underlying stories were found.");
  } else {
    for (const story of data.crossSurface) {
      lines.push(storyLine(story, generatedAt, true));
    }
  }

  lines.push("", "## Balanced 24-hour CT + Following pulse", "");
  for (const story of data.balanced) lines.push(storyLine(story, generatedAt));

  lines.push("", "## For You algorithm lens", "");
  for (const story of data.forYou) {
    lines.push(storyLine(story, generatedAt, true));
  }

  lines.push("", "## Promotion or coordinated-push hints", "");
  if (data.promotionHints.length === 0) {
    lines.push("- No obvious promotion patterns were detected.");
  } else {
    for (const story of data.promotionHints) {
      lines.push(storyLine(story, generatedAt));
    }
  }

  lines.push(
    "",
    "_Topic and promotion labels are intentionally conservative heuristics. Material claims still require reading the linked post and, where important, checking a primary source._",
    "",
  );
  return lines.join("\n");
}

async function main() {
  parseArguments(process.argv.slice(2));

  const generatedAt = new Date();
  const cutoff = new Date(generatedAt.getTime() - config.hours * 60 * 60 * 1000);
  const freshnessCutoff = new Date(
    generatedAt.getTime() - 24 * 60 * 60 * 1000,
  );

  const [birdVersionRaw, identityRaw, ctRaw, followingRaw, forYouRaw] =
    await Promise.all([
      run("bird", ["--version"]),
      run("bird", ["whoami", "--plain"]),
      run("bird", [
        "list-timeline",
        config.listId,
        "-n",
        String(config.ctCount),
        "--json",
      ]),
      run("bird", [
        "home",
        "--following",
        "-n",
        String(config.followingCount),
        "--json",
      ]),
      run("bird", ["home", "-n", String(config.homeCount), "--json"]),
    ]);

  const ct = parseBirdJson(ctRaw, "CT list").map((post) =>
    normalizePost(post, "ct"),
  );
  const following = parseBirdJson(followingRaw, "Following").map((post) =>
    normalizePost(post, "following"),
  );
  const forYou = parseBirdJson(forYouRaw, "For You").map((post) =>
    normalizePost(post, "forYou"),
  );
  resolveCompactRetweets([...ct, ...following, ...forYou]);

  const currentCt = ct.filter((post) => withinWindow(post, cutoff));
  const currentFollowing = following.filter((post) => withinWindow(post, cutoff));
  const currentCombined = [...currentCt, ...currentFollowing];
  const combinedStories = groupStories(currentCombined).sort(
    (a, b) =>
      new Date(b.latestSeenAt || 0).getTime() -
      new Date(a.latestSeenAt || 0).getTime(),
  );
  const forYouStories = groupStories(forYou).sort(
    (a, b) =>
      new Date(b.latestSeenAt || 0).getTime() -
      new Date(a.latestSeenAt || 0).getTime(),
  );

  const signalStories = combinedStories.filter((story) => !isLowSignalStory(story));
  const signalForYouStories = forYouStories.filter(
    (story) => !isLowSignalStory(story),
  );
  const balanced = balancedAcrossSurfaces(
    signalStories,
    config.authorCap,
    config.balancedLimit,
  );
  const balancedForYou = capByAuthor(
    signalForYouStories,
    config.homeAuthorCap,
    config.homeLimit,
  );
  const crossSurface = signalStories
    .filter((story) => story.surfaces.length >= 2)
    .sort(
      (a, b) =>
        b.appearances - a.appearances ||
        new Date(b.latestSeenAt || 0).getTime() -
          new Date(a.latestSeenAt || 0).getTime(),
    )
    .slice(0, 30);
  const promotionHints = combinedStories
    .filter(promotionHint)
    .sort(
      (a, b) =>
        b.appearances - a.appearances ||
        new Date(b.latestSeenAt || 0).getTime() -
          new Date(a.latestSeenAt || 0).getTime(),
    )
    .slice(0, 30);

  const diagnostics = {
    surfaces: {
      ct: metrics(ct, cutoff),
      following: metrics(following, cutoff),
      forYou: metrics(forYou, freshnessCutoff),
    },
    forYouFreshCount: forYou.filter((post) =>
      withinWindow(post, freshnessCutoff),
    ).length,
    overlap: {
      ctFollowing: {
        exact: exactOverlap(currentCt, currentFollowing),
        stories: storyOverlap(currentCt, currentFollowing),
      },
      ctForYou: {
        exact: exactOverlap(currentCt, forYou),
        stories: storyOverlap(currentCt, forYou),
      },
      followingForYou: {
        exact: exactOverlap(currentFollowing, forYou),
        stories: storyOverlap(currentFollowing, forYou),
      },
    },
    topicCounts: topicCounts(combinedStories),
    tickerCounts: tickerCounts(combinedStories),
    uniqueCombinedStories: combinedStories.length,
  };

  const data = {
    generatedAt: generatedAt.toISOString(),
    birdVersion: birdVersionRaw.trim(),
    identity: identityRaw.trim(),
    config: {
      listId: config.listId,
      hours: config.hours,
      ctCount: config.ctCount,
      followingCount: config.followingCount,
      homeCount: config.homeCount,
      authorCap: config.authorCap,
    },
    diagnostics,
    crossSurface,
    balanced,
    forYou: balancedForYou,
    promotionHints,
  };

  const markdown = markdownReport(data);
  await mkdir(config.outputDirectory, { recursive: true });
  const jsonPath = path.join(config.outputDirectory, "latest-ct-pulse.json");
  const markdownPath = path.join(config.outputDirectory, "latest-ct-pulse.md");
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(data, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, markdown, "utf8"),
  ]);

  process.stdout.write(
    `${markdownPath}\n${jsonPath}\n` +
      `Balanced stories: ${balanced.length}; cross-surface stories: ${crossSurface.length}; For You stories: ${balancedForYou.length}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`ct-pulse: ${error.message}\n`);
  process.exit(1);
});
