
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

const allowedOrigins = [
    "http://localhost:5173",
    process.env.FRONTEND_URL,
].filter((origin): origin is string => Boolean(origin));

app.use(helmet());
app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
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

app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", message: "Backend is running" });
});

const recommendationSchema = z.object({
    mode: z.enum(["genres", "personalized"]),
    genres: z.array(z.string().max(50)).max(12).default([]),
    mood: z.string().max(100).optional(),
    era: z.string().max(100).optional(),
    acclaim: z.string().max(100).optional(),
    origin: z.string().max(100).optional(),
    runtime: z.string().max(100).optional(),
    pacing: z.string().max(100).optional(),
    actors: z.array(z.string().max(100)).max(10).default([]),
    page: z.number().int().min(1).max(500).default(1),
});

type TMDbPerson = {
    id: number;
    name: string;
    popularity: number;
};

type TMDbPersonSearchResponse = {
    results?: TMDbPerson[];
};

type TMDbMovie = {
    id: number;
    title: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    release_date: string;
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

/**
 * Resolve a user-entered actor name to a TMDb person ID.
 * Prefer an exact case-insensitive name match; otherwise use TMDb's
 * most relevant search result. The returned ID is used for cast filtering.
 */
async function resolveActorId(name: string): Promise<number | null> {
    const params = new URLSearchParams({
        api_key: TMDB_API_KEY!,
        query: name,
        include_adult: "false",
        page: "1",
    });

    const response = await fetch(
        `https://api.themoviedb.org/3/search/person?${params.toString()}`,
    );

    if (!response.ok) {
        throw new Error(`TMDb person search failed with status ${response.status}`);
    }

    const data = (await response.json()) as TMDbPersonSearchResponse;
    const people = data.results ?? [];

    if (people.length === 0) return null;

    const normalizedName = name.trim().toLocaleLowerCase();
    const exactMatches = people.filter(
        (person) => person.name.trim().toLocaleLowerCase() === normalizedName,
    );

    const candidates = exactMatches.length > 0 ? exactMatches : people;
    candidates.sort((a, b) => b.popularity - a.popularity);

    return candidates[0]?.id ?? null;
}

app.post("/api/recommendations", async (req, res) => {
    const parsed = recommendationSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            error: "Invalid recommendation preferences",
            details: parsed.error.flatten(),
        });
    }

    if (!TMDB_API_KEY) {
        return res.status(500).json({
            error: "TMDB_API_KEY is not configured on the server",
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
        .map((genre) => genreIds[genre])
        .filter((id): id is number => id !== undefined);

    if (selectedGenreIds.length > 0) {
        params.set("with_genres", selectedGenreIds.join("|"));
    }

    if (preferences.era && eraRanges[preferences.era]) {
        const [startYear, endYear] = eraRanges[preferences.era];
        params.set("primary_release_date.gte", `${startYear}-01-01`);
        params.set("primary_release_date.lte", `${endYear}-12-31`);
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

    if (preferences.runtime === "Under 90 minutes") {
        params.set("with_runtime.lte", "89");
    } else if (preferences.runtime === "90–120 minutes") {
        params.set("with_runtime.gte", "90");
        params.set("with_runtime.lte", "120");
    } else if (preferences.runtime === "2–2.5 hours") {
        params.set("with_runtime.gte", "121");
        params.set("with_runtime.lte", "150");
    } else if (preferences.runtime === "Over 2.5 hours") {
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
                params.set("with_cast", castIds.join("|"));
            }
        }

        const response = await fetch(
            `https://api.themoviedb.org/3/discover/movie?${params.toString()}`,
        );

        if (!response.ok) {
            console.error("TMDb request failed:", response.status);
            return res.status(502).json({
                error: "The movie service could not complete the request",
            });
        }

        const data = (await response.json()) as {
            results?: TMDbMovie[];
            page?: number;
            total_pages?: number;
            total_results?: number;
        };

        const movies = (data.results ?? []).map((movie) => ({
            id: movie.id,
            title: movie.title,
            overview: movie.overview,
            posterUrl: movie.poster_path
                ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
                : null,
            backdropUrl: movie.backdrop_path
                ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}`
                : null,
            releaseDate: movie.release_date,
            rating: movie.vote_average,
            voteCount: movie.vote_count,
            genreIds: movie.genre_ids,
        }));

        return res.json({
            results: movies,
            page: data.page ?? preferences.page,
            totalPages: Math.min(data.total_pages ?? 1, 500),
            totalResults: data.total_results ?? movies.length,
        });
    } catch (error) {
        console.error("Recommendation request error:", error);
        return res.status(502).json({
            error: "Unable to connect to the movie service",
        });
    }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend running on port ${PORT}`);
});