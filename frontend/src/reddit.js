// Fetches a random Spanish Reddit story from the browser (avoids server-side 403s).

const SUBREDDITS = [
  "HistoriasDeReddit",
  "AskRedditEsp",
  "confesiones",
  "anecdotasgraciosas",
  "es",
];

export async function fetchRandomStory() {
  const shuffled = [...SUBREDDITS].sort(() => Math.random() - 0.5);
  const errors = [];

  for (const sub of shuffled) {
    try {
      const res = await fetch(
        `https://www.reddit.com/r/${sub}/top.json?limit=25&t=week`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) {
        errors.push(`r/${sub}: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const posts = data?.data?.children
        ?.map((c) => c.data)
        .filter(
          (p) =>
            p.is_self &&
            typeof p.selftext === "string" &&
            p.selftext.length > 200 &&
            p.selftext.length < 3000 &&
            p.selftext !== "[deleted]" &&
            p.selftext !== "[removed]" &&
            !p.over_18 &&
            !p.stickied
        );

      if (!posts?.length) {
        errors.push(`r/${sub}: sin posts válidos`);
        continue;
      }

      const post = posts[Math.floor(Math.random() * posts.length)];
      return {
        subreddit: sub,
        title: post.title,
        text: post.selftext,
        author: post.author,
        url: `https://reddit.com${post.permalink}`,
      };
    } catch (err) {
      errors.push(`r/${sub}: ${err.message}`);
    }
  }

  throw new Error(`No se encontró ninguna historia: ${errors.join(" | ")}`);
}
