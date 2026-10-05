
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";

dotenv.config();

const app = express();
// Render terminates TLS through one trusted proxy in production.
if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}
const PORT = Number(process.env.PORT) || 3000;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

const configuredOrigins = [
    process.env.FRONTEND_URL,
    process.env.FRONTEND_URLS,
]
    .flatMap((value) => value?.split(",") ?? [])
    .map((origin) => origin.trim())
    .filter(Boolean);

const allowedOrigins = new Set([
    ...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:5173"]),
    ...configuredOrigins,
]);

app.use(helmet());
app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.has(origin)) {
                callback(null, true);
            } else {
                callback(new Error("Origin not allowed by CORS"));
            }
        },
    }),
);
app.use(express.json({ limit: "10kb" }));

app.use(
    rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 100,
        standardHeaders: "draft-8",
        legacyHeaders: false,
    }),
);

const recommendationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many recommendation requests. Please try again later." },
});

app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", message: "Backend is running" });
});


const personSearchLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many people searches. Please try again later." },
});

app.get("/api/people/search", personSearchLimiter, async (req, res) => {
    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (query.length < 2 || query.length > 100) {
        return res.status(400).json({ error: "Enter between 2 and 100 characters to search." });
    }
    if (!TMDB_API_KEY) {
        return res.status(500).json({ error: "People search is not configured" });
    }
    try {
        const params = new URLSearchParams({ api_key: TMDB_API_KEY, query, include_adult: "false", page: "1" });
        const response = await fetch(`https://api.themoviedb.org/3/search/person?${params.toString()}`,
            { signal: AbortSignal.timeout(TMDB_REQUEST_TIMEOUT_MS) });
        if (!response.ok) {
            console.error("TMDb people search failed:", response.status);
            return res.status(502).json({ error: "People search is temporarily unavailable." });
        }
        const data = (await response.json()) as {
            results?: Array<{ id: number; name: string; known_for_department?: string; profile_path?: string | null; popularity?: number }>;
        };
        const results = (data.results ?? [])
            .filter((person) => Number.isInteger(person.id) && typeof person.name === "string")
            .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
            .slice(0, 3)
            .map((person) => ({
                id: person.id,
                name: person.name,
                knownForDepartment: person.known_for_department ?? "Performer",
                profileUrl: person.profile_path ? `https://image.tmdb.org/t/p/w185${person.profile_path}` : null,
            }));
        return res.json({ results });
    } catch (error) {
        console.error("People search request error:", error);
        return res.status(502).json({ error: "Unable to connect to the people search service." });
    }
});

const recommendationSchema = z.object({
    mode: z.enum(["genres", "personalized"]),
    mediaType: z.enum(["movie", "tv"]).default("movie"),
    genres: z.array(z.string().trim().min(1).max(50)).max(12).default([]),
    mood: z.string().trim().min(1).max(100).optional(),
    era: z.string().trim().min(1).max(100).optional(),
    acclaim: z.string().trim().min(1).max(100).optional(),
    origin: z.string().trim().min(1).max(100).optional(),
    runtime: z.string().trim().min(1).max(100).optional(),
    pacing: z.string().trim().min(1).max(100).optional(),
    actors: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
    page: z.number().int().min(1).max(500).default(1),
}).superRefine((preferences, ctx) => {
    const validGenres = preferences.mediaType === "tv" ? tvGenreIds : genreIds;

    preferences.genres.forEach((genre, index) => {
        if (!Object.prototype.hasOwnProperty.call(validGenres, genre)) {
            ctx.addIssue({
                code: "custom",
                path: ["genres", index],
                message: "Unsupported genre",
            });
        }
    });

    if (preferences.mode === "genres" && preferences.genres.length === 0) {
        ctx.addIssue({
            code: "custom",
            path: ["genres"],
            message: "Select at least one genre",
        });
    }
});

type TMDbPerson = {
    id: number;
    name: string;
    popularity: number;
};

type TMDbPersonSearchResponse = {
    results?: TMDbPerson[];
};

type TMDbMedia = {
    id: number;
    title?: string;
    name?: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    release_date?: string;
    first_air_date?: string;
    vote_average: number;
    vote_count: number;
    genre_ids: number[];
};

const genreIds: Record<string, number> = {
    Action: 28,
    Adventure: 12,
    Animation: 16,
    Comedy: 35,
    Crime: 80,
    Documentary: 99,
    Drama: 18,
    Family: 10751,
    Fantasy: 14,
    History: 36,
    Horror: 27,
    Music: 10402,
    Mystery: 9648,
    Romance: 10749,
    "Science fiction": 878,
    Thriller: 53,
};

const tvGenreIds: Record<string, number> = {
    Action: 10759,
    Adventure: 10759,
    Animation: 16,
    Comedy: 35,
    Crime: 80,
    Documentary: 99,
    Drama: 18,
    Family: 10751,
    Fantasy: 10765,
    History: 10768,
    Music: 10764,
    Horror: 9648,
    Romance: 18,
    Thriller: 80,
    Mystery: 9648,
    "Science fiction": 10765,
};

const eraRanges: Record<string, [number, number]> = {
    "Classic cinema (before 1970)": [1900, 1969],
    "1970–1989": [1970, 1989],
    "1990–2004": [1990, 2004],
    "2005–2014": [2005, 2014],
    "2015 onwards": [2015, new Date().getFullYear()],
};

const originCodes: Record<string, string> = {
    "Hollywood / English-language": "US",
    "Indian cinema": "IN",
    "Sri Lankan cinema": "LK",
    "Korean cinema": "KR",
    "Japanese cinema": "JP",
    "European cinema": "FR|DE|IT|ES|GB",
};

const TMDB_REQUEST_TIMEOUT_MS = 8_000;
const ACTOR_CACHE_MAX_ENTRIES = 500;
const ACTOR_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_ACTOR_CACHE_TTL_MS = 5 * 60 * 1000;

const actorCache = new Map<string, { id: number | null; expiresAt: number }>();
const actorLookupsInFlight = new Map<string, Promise<number | null>>();

/**
 * Resolve a user-entered actor name to a TMDb person ID.
 * Cache successful and unsuccessful lookups, and share concurrent lookups
 * for the same normalized name to reduce external API usage.
 */
async function resolveActorId(name: string): Promise<number | null> {
    const normalizedName = name.trim().toLocaleLowerCase();
    const cached = actorCache.get(normalizedName);

    if (cached && cached.expiresAt > Date.now()) {
        return cached.id;
    }
    if (cached) actorCache.delete(normalizedName);

    const inFlight = actorLookupsInFlight.get(normalizedName);
    if (inFlight) return inFlight;

    const lookup = (async (): Promise<number | null> => {
        const params = new URLSearchParams({
            api_key: TMDB_API_KEY!,
            query: name.trim(),
            include_adult: "false",
            page: "1",
        });

        const response = await fetch(
            `https://api.themoviedb.org/3/search/person?${params.toString()}`,
            { signal: AbortSignal.timeout(TMDB_REQUEST_TIMEOUT_MS) },
        );

        if (!response.ok) {
            throw new Error(`TMDb person search failed with status ${response.status}`);
        }

        const data = (await response.json()) as TMDbPersonSearchResponse;
        const people = data.results ?? [];

        const exactMatches = people.filter(
            (person) => person.name.trim().toLocaleLowerCase() === normalizedName,
        );

        const candidates = exactMatches.length > 0 ? exactMatches : people;
        candidates.sort((a, b) => b.popularity - a.popularity);

        const id = candidates[0]?.id ?? null;
        actorCache.set(normalizedName, {
            id,
            expiresAt: Date.now() + (id === null ? NEGATIVE_ACTOR_CACHE_TTL_MS : ACTOR_CACHE_TTL_MS),
        });

        while (actorCache.size > ACTOR_CACHE_MAX_ENTRIES) {
            const oldestKey = actorCache.keys().next().value;
            if (oldestKey === undefined) break;
            actorCache.delete(oldestKey);
        }

        return id;
    })();

    actorLookupsInFlight.set(normalizedName, lookup);
    try {
        return await lookup;
    } finally {
        actorLookupsInFlight.delete(normalizedName);
    }
}

app.post("/api/recommendations", recommendationLimiter, async (req, res) => {
    const parsed = recommendationSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            error: "Invalid recommendation preferences",
            details: parsed.error.flatten(),
        });
    }

    if (!TMDB_API_KEY) {
        return res.status(500).json({
            error: "Recommendation service is not configured",
        });
    }

    const preferences = parsed.data;

    const params = new URLSearchParams({
        api_key: TMDB_API_KEY,
        language: "en-US",
        sort_by: "popularity.desc",
        include_adult: "false",
        page: String(preferences.page),
    });

    const selectedGenreIds = preferences.genres
        .map((genre) => (preferences.mediaType === "tv" ? tvGenreIds[genre] : genreIds[genre]))
        .filter((id): id is number => id !== undefined);

    if (selectedGenreIds.length > 0) {
        params.set("with_genres", selectedGenreIds.join("|"));
    }

    if (preferences.era && eraRanges[preferences.era]) {
        const [startYear, endYear] = eraRanges[preferences.era];
        const dateField = preferences.mediaType === "tv" ? "first_air_date" : "primary_release_date";
        params.set(`${dateField}.gte`, `${startYear}-01-01`);
        params.set(`${dateField}.lte`, `${endYear}-12-31`);
    }

    if (preferences.acclaim === "Highly rated by audiences") {
        params.set("sort_by", "vote_average.desc");
        params.set("vote_count.gte", "100");
    } else if (
        preferences.acclaim === "Award-winning or critically acclaimed"
    ) {
        params.set("sort_by", "vote_average.desc");
        params.set("vote_count.gte", "250");
    } else if (preferences.acclaim === "Popular mainstream movies") {
        params.set("sort_by", "popularity.desc");
    } else if (
        preferences.acclaim === "Hidden gems and underrated movies"
    ) {
        params.set("sort_by", "vote_average.desc");
        params.set("vote_count.gte", "20");
        params.set("vote_count.lte", "500");
    }

    if (preferences.mediaType === "movie" && preferences.runtime === "Under 90 minutes") {
        params.set("with_runtime.lte", "89");
    } else if (preferences.mediaType === "movie" && preferences.runtime === "90–120 minutes") {
        params.set("with_runtime.gte", "90");
        params.set("with_runtime.lte", "120");
    } else if (preferences.mediaType === "movie" && preferences.runtime === "2–2.5 hours") {
        params.set("with_runtime.gte", "121");
        params.set("with_runtime.lte", "150");
    } else if (preferences.mediaType === "movie" && preferences.runtime === "Over 2.5 hours") {
        params.set("with_runtime.gte", "151");
    }

    if (preferences.origin && originCodes[preferences.origin]) {
        params.set("with_origin_country", originCodes[preferences.origin]);
    }

    try {
        if (preferences.actors.length > 0) {
            const resolvedActorIds = await Promise.all(
                preferences.actors.map((actor) => resolveActorId(actor)),
            );

            const unresolvedActors = preferences.actors.filter(
                (_actor, index) => resolvedActorIds[index] === null,
            );

            if (unresolvedActors.length > 0) {
                return res.status(422).json({
                    error: `Could not find actor or actress: ${unresolvedActors.join(", ")}. Check the spelling and try again.`,
                });
            }

            // Pipe-separated cast IDs match movies featuring ANY selected actor.
            // Supporting and minor credited cast roles are included by TMDb.
            const castIds = resolvedActorIds.filter(
                (id): id is number => id !== null,
            );

            if (castIds.length > 0) {
                params.set(preferences.mediaType === "tv" ? "with_people" : "with_cast", castIds.join("|"));
            }
        }

        const response = await fetch(
            `https://api.themoviedb.org/3/discover/${preferences.mediaType}?${params.toString()}`,
            { signal: AbortSignal.timeout(TMDB_REQUEST_TIMEOUT_MS) },
        );

        if (!response.ok) {
            console.error("TMDb request failed:", response.status);
            return res.status(502).json({
                error: `The ${preferences.mediaType === "tv" ? "TV" : "movie"} service could not complete the request`,
            });
        }

        const data = (await response.json()) as {
            results?: TMDbMedia[];
            page?: number;
            total_pages?: number;
            total_results?: number;
        };

        const recommendations = (data.results ?? []).map((item) => ({
            id: item.id,
            title: preferences.mediaType === "tv" ? (item.name ?? "Untitled series") : (item.title ?? "Untitled"),
            overview: item.overview,
            posterUrl: item.poster_path
                ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
                : null,
            backdropUrl: item.backdrop_path
                ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
                : null,
            releaseDate: preferences.mediaType === "tv" ? (item.first_air_date ?? "") : (item.release_date ?? ""),
            rating: item.vote_average,
            voteCount: item.vote_count,
            genreIds: item.genre_ids,
        }));

        return res.json({
            results: recommendations,
            page: data.page ?? preferences.page,
            totalPages: Math.min(data.total_pages ?? 1, 500),
            totalResults: data.total_results ?? recommendations.length,
        });
    } catch (error) {
        console.error("Recommendation request error:", error);
        return res.status(502).json({
            error: `Unable to connect to the ${preferences.mediaType === "tv" ? "TV" : "movie"} service`,
        });
    }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend running on port ${PORT}`);
});