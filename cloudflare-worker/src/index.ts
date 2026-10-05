import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { httpServerHandler } from "cloudflare:node";

const app = express();

const PORT = 3000;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

const configuredOrigins = [
	process.env.FRONTEND_URL,
	process.env.FRONTEND_URLS,
]
	.flatMap((value) => value?.split(",") ?? [])
	.map((origin) => origin.trim())
	.filter(Boolean);

const allowedOrigins = new Set([
	"http://localhost:5173",
	"http://localhost:4173",
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

/* -------------------------------------------------------------------------- */
/* Cloudflare-compatible rate limiting                                        */
/* -------------------------------------------------------------------------- */

type RateLimitEntry = {
	count: number;
	resetAt: number;
};

function createRateLimiter(
	limit: number,
	windowMs: number,
	message: { error: string },
) {
	const store = new Map<string, RateLimitEntry>();

	return (
		req: express.Request,
		res: express.Response,
		next: express.NextFunction,
	) => {
		const now = Date.now();

		const forwardedFor = req.headers["x-forwarded-for"];

		const forwardedIp =
			typeof forwardedFor === "string"
				? forwardedFor.split(",")[0]?.trim()
				: undefined;

		const key =
			req.headers["cf-connecting-ip"]?.toString() ||
			forwardedIp ||
			req.ip ||
			"unknown";

		const existing = store.get(key);

		if (!existing || existing.resetAt <= now) {
			store.set(key, {
				count: 1,
				resetAt: now + windowMs,
			});

			return next();
		}

		existing.count += 1;

		if (existing.count > limit) {
			const retryAfterSeconds = Math.ceil(
				(existing.resetAt - now) / 1000,
			);

			res.setHeader(
				"Retry-After",
				String(retryAfterSeconds),
			);

			return res.status(429).json(message);
		}

		next();
	};
}

const generalLimiter = createRateLimiter(
	100,
	15 * 60 * 1000,
	{
		error: "Too many requests. Please try again later.",
	},
);

app.use(generalLimiter);

const recommendationLimiter = createRateLimiter(
	30,
	15 * 60 * 1000,
	{
		error:
			"Too many recommendation requests. Please try again later.",
	},
);

const personSearchLimiter = createRateLimiter(
	60,
	15 * 60 * 1000,
	{
		error:
			"Too many people searches. Please try again later.",
	},
);

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const TMDB_REQUEST_TIMEOUT_MS = 8_000;

const ACTOR_CACHE_MAX_ENTRIES = 500;
const ACTOR_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_ACTOR_CACHE_TTL_MS = 5 * 60 * 1000;

/*
 * TV actor matching can potentially produce many candidate shows.
 * We inspect a reasonable number of candidates so the Worker does not
 * make an excessive number of TMDb requests in a single recommendation.
 */
const MAX_TV_ACTOR_CANDIDATES = 100;

/* -------------------------------------------------------------------------- */
/* Health                                                                    */
/* -------------------------------------------------------------------------- */

app.get("/api/health", (_req, res) => {
	res.json({
		status: "ok",
		message: "Backend is running",
	});
});

/* -------------------------------------------------------------------------- */
/* People search                                                              */
/* -------------------------------------------------------------------------- */

app.get(
	"/api/people/search",
	personSearchLimiter,
	async (req, res) => {
		const query =
			typeof req.query.query === "string"
				? req.query.query.trim()
				: "";

		if (query.length < 2 || query.length > 100) {
			return res.status(400).json({
				error:
					"Enter between 2 and 100 characters to search.",
			});
		}

		if (!TMDB_API_KEY) {
			return res.status(500).json({
				error: "People search is not configured",
			});
		}

		try {
			const params = new URLSearchParams({
				api_key: TMDB_API_KEY,
				query,
				include_adult: "false",
				page: "1",
			});

			const response = await fetch(
				`https://api.themoviedb.org/3/search/person?${params.toString()}`,
				{
					signal: AbortSignal.timeout(
						TMDB_REQUEST_TIMEOUT_MS,
					),
				},
			);

			if (!response.ok) {
				console.error(
					"TMDb people search failed:",
					response.status,
				);

				return res.status(502).json({
					error:
						"People search is temporarily unavailable.",
				});
			}

			const data = (await response.json()) as {
				results?: Array<{
					id: number;
					name: string;
					known_for_department?: string;
					profile_path?: string | null;
					popularity?: number;
				}>;
			};

			const results = (data.results ?? [])
				.filter(
					(person) =>
						Number.isInteger(person.id) &&
						typeof person.name === "string",
				)
				.sort(
					(a, b) =>
						(b.popularity ?? 0) -
						(a.popularity ?? 0),
				)
				.slice(0, 3)
				.map((person) => ({
					id: person.id,
					name: person.name,
					knownForDepartment:
						person.known_for_department ??
						"Performer",
					profileUrl: person.profile_path
						? `https://image.tmdb.org/t/p/w185${person.profile_path}`
						: null,
				}));

			return res.json({ results });
		} catch (error) {
			console.error(
				"People search request error:",
				error,
			);

			return res.status(502).json({
				error:
					"Unable to connect to the people search service.",
			});
		}
	},
);

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

const recommendationSchema = z
	.object({
		mode: z.enum(["genres", "personalized"]),

		mediaType: z
			.enum(["movie", "tv"])
			.default("movie"),

		genres: z
			.array(
				z
					.string()
					.trim()
					.min(1)
					.max(50),
			)
			.max(12)
			.default([]),

		mood: z
			.string()
			.trim()
			.min(1)
			.max(100)
			.optional(),

		era: z
			.string()
			.trim()
			.min(1)
			.max(100)
			.optional(),

		acclaim: z
			.string()
			.trim()
			.min(1)
			.max(100)
			.optional(),

		origin: z
			.string()
			.trim()
			.min(1)
			.max(100)
			.optional(),

		runtime: z
			.string()
			.trim()
			.min(1)
			.max(100)
			.optional(),

		pacing: z
			.string()
			.trim()
			.min(1)
			.max(100)
			.optional(),

		actors: z
			.array(
				z
					.string()
					.trim()
					.min(1)
					.max(100),
			)
			.max(10)
			.default([]),

		page: z
			.number()
			.int()
			.min(1)
			.max(500)
			.default(1),
	})
	.superRefine((preferences, ctx) => {
		const validGenres =
			preferences.mediaType === "tv"
				? tvGenreIds
				: genreIds;

		preferences.genres.forEach((genre, index) => {
			if (
				!Object.prototype.hasOwnProperty.call(
					validGenres,
					genre,
				)
			) {
				ctx.addIssue({
					code: "custom",
					path: ["genres", index],
					message: "Unsupported genre",
				});
			}
		});

		if (
			preferences.mode === "genres" &&
			preferences.genres.length === 0
		) {
			ctx.addIssue({
				code: "custom",
				path: ["genres"],
				message: "Select at least one genre",
			});
		}
	});

/* -------------------------------------------------------------------------- */
/* TMDb types                                                                 */
/* -------------------------------------------------------------------------- */

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

type TMDbTVCredit = {
	id: number;
	name?: string;
	first_air_date?: string;
	genre_ids?: number[];
};

type TMDbTVCreditsResponse = {
	cast?: TMDbTVCredit[];
};

type TMDbTVDetails = {
	id: number;
	name?: string;
	overview: string;
	poster_path: string | null;
	backdrop_path: string | null;
	first_air_date?: string;
	vote_average: number;
	vote_count: number;
	genre_ids: number[];
	backdrop_path?: string | null;
	origin_country?: string[];
	episode_run_time?: number[];
	popularity?: number;
};

/* -------------------------------------------------------------------------- */
/* Genre / preference maps                                                    */
/* -------------------------------------------------------------------------- */

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
	"2015 onwards": [
		2015,
		new Date().getFullYear(),
	],
};

const originCodes: Record<string, string> = {
	"Hollywood / English-language": "US",
	"Indian cinema": "IN",
	"Sri Lankan cinema": "LK",
	"Korean cinema": "KR",
	"Japanese cinema": "JP",
	"European cinema": "FR|DE|IT|ES|GB",
};

/* -------------------------------------------------------------------------- */
/* Actor cache                                                                */
/* -------------------------------------------------------------------------- */

const actorCache = new Map<
	string,
	{
		id: number | null;
		expiresAt: number;
	}
>();

const actorLookupsInFlight = new Map<
	string,
	Promise<number | null>
>();

async function resolveActorId(
	name: string,
): Promise<number | null> {
	const normalizedName =
		name.trim().toLocaleLowerCase();

	const cached =
		actorCache.get(normalizedName);

	if (
		cached &&
		cached.expiresAt > Date.now()
	) {
		return cached.id;
	}

	if (cached) {
		actorCache.delete(normalizedName);
	}

	const inFlight =
		actorLookupsInFlight.get(
			normalizedName,
		);

	if (inFlight) {
		return inFlight;
	}

	const lookup = (async (): Promise<
		number | null
	> => {
		const params = new URLSearchParams({
			api_key: TMDB_API_KEY!,
			query: name.trim(),
			include_adult: "false",
			page: "1",
		});

		const response = await fetch(
			`https://api.themoviedb.org/3/search/person?${params.toString()}`,
			{
				signal: AbortSignal.timeout(
					TMDB_REQUEST_TIMEOUT_MS,
				),
			},
		);

		if (!response.ok) {
			throw new Error(
				`TMDb person search failed with status ${response.status}`,
			);
		}

		const data =
			(await response.json()) as TMDbPersonSearchResponse;

		const people = data.results ?? [];

		const exactMatches =
			people.filter(
				(person) =>
					person.name
						.trim()
						.toLocaleLowerCase() ===
					normalizedName,
			);

		const candidates =
			exactMatches.length > 0
				? exactMatches
				: people;

		candidates.sort(
			(a, b) =>
				b.popularity -
				a.popularity,
		);

		const id =
			candidates[0]?.id ?? null;

		actorCache.set(
			normalizedName,
			{
				id,
				expiresAt:
					Date.now() +
					(id === null
						? NEGATIVE_ACTOR_CACHE_TTL_MS
						: ACTOR_CACHE_TTL_MS),
			},
		);

		while (
			actorCache.size >
			ACTOR_CACHE_MAX_ENTRIES
			) {
			const oldestKey =
				actorCache.keys().next()
					.value;

			if (
				oldestKey === undefined
			) {
				break;
			}

			actorCache.delete(oldestKey);
		}

		return id;
	})();

	actorLookupsInFlight.set(
		normalizedName,
		lookup,
	);

	try {
		return await lookup;
	} finally {
		actorLookupsInFlight.delete(
			normalizedName,
		);
	}
}

/* -------------------------------------------------------------------------- */
/* TV actor credit cache                                                      */
/* -------------------------------------------------------------------------- */

const tvActorCreditsCache = new Map<
	number,
	{
		ids: Set<number>;
		expiresAt: number;
	}
>();

async function getActorTVSeriesIds(
	personId: number,
): Promise<Set<number>> {
	const cached =
		tvActorCreditsCache.get(personId);

	if (
		cached &&
		cached.expiresAt > Date.now()
	) {
		return cached.ids;
	}

	const params = new URLSearchParams({
		api_key: TMDB_API_KEY!,
		language: "en-US",
	});

	const response = await fetch(
		`https://api.themoviedb.org/3/person/${personId}/tv_credits?${params.toString()}`,
		{
			signal: AbortSignal.timeout(
				TMDB_REQUEST_TIMEOUT_MS,
			),
		},
	);

	if (!response.ok) {
		throw new Error(
			`TMDb TV credits request failed with status ${response.status}`,
		);
	}

	const data =
		(await response.json()) as TMDbTVCreditsResponse;

	const ids = new Set<number>();

	for (const credit of data.cast ?? []) {
		if (Number.isInteger(credit.id)) {
			ids.add(credit.id);
		}
	}

	tvActorCreditsCache.set(personId, {
		ids,
		expiresAt:
			Date.now() +
			ACTOR_CACHE_TTL_MS,
	});

	return ids;
}

/* -------------------------------------------------------------------------- */
/* TV details                                                                 */
/* -------------------------------------------------------------------------- */

async function getTVDetails(
	id: number,
): Promise<TMDbTVDetails | null> {
	const params = new URLSearchParams({
		api_key: TMDB_API_KEY!,
		language: "en-US",
	});

	const response = await fetch(
		`https://api.themoviedb.org/3/tv/${id}?${params.toString()}`,
		{
			signal: AbortSignal.timeout(
				TMDB_REQUEST_TIMEOUT_MS,
			),
		},
	);

	if (!response.ok) {
		console.error(
			"TMDb TV details failed:",
			response.status,
			id,
		);

		return null;
	}

	return (await response.json()) as TMDbTVDetails;
}

/* -------------------------------------------------------------------------- */
/* TV filtering helpers                                                       */
/* -------------------------------------------------------------------------- */

function matchesTVFilters(
	item: TMDbTVDetails,
	preferences: z.infer<
		typeof recommendationSchema
	>,
): boolean {
	if (
		preferences.genres.length > 0
	) {
		const selectedGenreIds =
			preferences.genres
				.map(
					(genre) =>
						tvGenreIds[genre],
				)
				.filter(
					(
						id,
					): id is number =>
						id !== undefined,
				);

		const hasAllGenres =
			selectedGenreIds.every(
				(genreId) =>
					item.genre_ids.includes(
						genreId,
					),
			);

		if (!hasAllGenres) {
			return false;
		}
	}

	if (
		preferences.era &&
		eraRanges[preferences.era]
	) {
		const [
			startYear,
			endYear,
		] =
			eraRanges[
				preferences.era
				];

		const year = item.first_air_date
			? Number(
				item.first_air_date.slice(
					0,
					4,
				),
			)
			: 0;

		if (
			!year ||
			year < startYear ||
			year > endYear
		) {
			return false;
		}
	}

	if (
		preferences.origin &&
		originCodes[
			preferences.origin
			]
	) {
		const allowedCountries =
			originCodes[
				preferences.origin
				].split("|");

		const hasOrigin =
			(item.origin_country ??
				[]).some((country) =>
				allowedCountries.includes(
					country,
				),
			);

		if (!hasOrigin) {
			return false;
		}
	}

	if (
		preferences.acclaim ===
		"Highly rated by audiences"
	) {
		if (
			item.vote_count < 100 ||
			item.vote_average <= 0
		) {
			return false;
		}
	}

	if (
		preferences.acclaim ===
		"Award-winning or critically acclaimed"
	) {
		if (
			item.vote_count < 250 ||
			item.vote_average <= 0
		) {
			return false;
		}
	}

	if (
		preferences.acclaim ===
		"Hidden gems and underrated movies"
	) {
		if (
			item.vote_count < 20 ||
			item.vote_count > 500
		) {
			return false;
		}
	}

	if (
		preferences.runtime &&
		item.episode_run_time &&
		item.episode_run_time.length > 0
	) {
		const runtime =
			item.episode_run_time[0];

		if (
			preferences.runtime ===
			"Under 90 minutes" &&
			runtime >= 90
		) {
			return false;
		}

		if (
			preferences.runtime ===
			"90–120 minutes" &&
			(runtime < 90 ||
				runtime > 120)
		) {
			return false;
		}

		if (
			preferences.runtime ===
			"2–2.5 hours" &&
			(runtime < 121 ||
				runtime > 150)
		) {
			return false;
		}

		if (
			preferences.runtime ===
			"Over 2.5 hours" &&
			runtime <= 150
		) {
			return false;
		}
	}

	return true;
}

/* -------------------------------------------------------------------------- */
/* TV actor recommendation                                                    */
/* -------------------------------------------------------------------------- */

async function getTVActorCandidates(
	actorIds: number[],
): Promise<number[]> {
	if (actorIds.length === 0) {
		return [];
	}

	const actorSets =
		await Promise.all(
			actorIds.map((id) =>
				getActorTVSeriesIds(id),
			),
		);

	if (actorSets.length === 0) {
		return [];
	}

	/*
	 * Start with the smallest actor credit set.
	 * This reduces the amount of intersection work.
	 */
	actorSets.sort(
		(a, b) =>
			a.size - b.size,
	);

	const intersection =
		new Set(actorSets[0]);

	for (
		let i = 1;
		i < actorSets.length;
		i++
	) {
		for (
			const showId of intersection
			) {
			if (
				!actorSets[i].has(showId)
			) {
				intersection.delete(
					showId,
				);
			}
		}

		if (
			intersection.size === 0
		) {
			break;
		}
	}

	return Array.from(
		intersection,
	).slice(
		0,
		MAX_TV_ACTOR_CANDIDATES,
	);
}

/* -------------------------------------------------------------------------- */
/* Recommendations                                                            */
/* -------------------------------------------------------------------------- */

app.post(
	"/api/recommendations",
	recommendationLimiter,
	async (req, res) => {
		const parsed =
			recommendationSchema.safeParse(
				req.body,
			);

		if (!parsed.success) {
			return res.status(400).json({
				error:
					"Invalid recommendation preferences",
				details:
					parsed.error.flatten(),
			});
		}

		if (!TMDB_API_KEY) {
			return res.status(500).json({
				error:
					"Recommendation service is not configured",
			});
		}

		const preferences =
			parsed.data;

		try {
			/* ------------------------------------------------------------------ */
			/* TV with actors: intersection-based implementation                 */
			/* ------------------------------------------------------------------ */

			if (
				preferences.mediaType ===
				"tv" &&
				preferences.actors.length >
				0
			) {
				const resolvedActorIds =
					await Promise.all(
						preferences.actors.map(
							(actor) =>
								resolveActorId(
									actor,
								),
						),
					);

				const unresolvedActors =
					preferences.actors.filter(
						(
							_actor,
							index,
						) =>
							resolvedActorIds[
								index
								] === null,
					);

				if (
					unresolvedActors.length >
					0
				) {
					return res
						.status(422)
						.json({
							error:
								`Could not find actor or actress: ${unresolvedActors.join(", ")}. Check the spelling and try again.`,
						});
				}

				const actorIds =
					resolvedActorIds.filter(
						(
							id,
						): id is number =>
							id !== null,
					);

				const candidateIds =
					await getTVActorCandidates(
						actorIds,
					);

				if (
					candidateIds.length ===
					0
				) {
					return res.json({
						results: [],
						page:
						preferences.page,
						totalPages: 0,
						totalResults: 0,
						message:
							"No TV series were found featuring all of the selected actors.",
					});
				}

				/*
				 * Fetch the actual TV details so we can apply the
				 * questionnaire filters that Discover TV cannot combine
				 * with actor credits.
				 */
				const detailResults =
					await Promise.all(
						candidateIds.map(
							(id) =>
								getTVDetails(
									id,
								),
						),
					);

				let matchingShows =
					detailResults.filter(
						(
							item,
						): item is TMDbTVDetails =>
							item !== null &&
							matchesTVFilters(
								item,
								preferences,
							),
					);

				/* -------------------------------------------------------------- */
				/* Sorting                                                        */
				/* -------------------------------------------------------------- */

				if (
					preferences.acclaim ===
					"Highly rated by audiences" ||
					preferences.acclaim ===
					"Award-winning or critically acclaimed" ||
					preferences.acclaim ===
					"Hidden gems and underrated movies"
				) {
					matchingShows.sort(
						(a, b) =>
							b.vote_average -
							a.vote_average,
					);
				} else {
					matchingShows.sort(
						(a, b) =>
							(b.popularity ??
								0) -
							(a.popularity ??
								0),
					);
				}

				const totalResults =
					matchingShows.length;

				const pageSize = 20;

				const totalPages =
					Math.ceil(
						totalResults /
						pageSize,
					);

				const safePage = Math.min(
					Math.max(
						preferences.page,
						1,
					),
					Math.max(
						totalPages,
						1,
					),
				);

				const start =
					(safePage - 1) *
					pageSize;

				const pageResults =
					matchingShows.slice(
						start,
						start + pageSize,
					);

				const recommendations =
					pageResults.map(
						(item) => ({
							id: item.id,

							title:
								item.name ??
								"Untitled series",

							overview:
							item.overview,

							posterUrl:
								item.poster_path
									? `https://image.tmdb.org/t/p/w500${item.poster_path}`
									: null,

							backdropUrl:
								item.backdrop_path
									? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
									: null,

							releaseDate:
								item.first_air_date ??
								"",

							rating:
							item.vote_average,

							voteCount:
							item.vote_count,

							genreIds:
							item.genre_ids,
						}),
					);

				return res.json({
					results:
					recommendations,

					page:
						totalResults === 0
							? preferences.page
							: safePage,

					totalPages,

					totalResults,

					...(totalResults ===
					0
						? {
							message:
								"No TV series were found featuring all of the selected actors and matching your other preferences.",
						}
						: {}),
				});
			}

			/* ------------------------------------------------------------------ */
			/* Movie / TV without actor intersection                              */
			/* ------------------------------------------------------------------ */

			const params =
				new URLSearchParams({
					api_key: TMDB_API_KEY,
					language: "en-US",
					sort_by:
						"popularity.desc",
					include_adult:
						"false",
					page: String(
						preferences.page,
					),
				});

			const selectedGenreIds =
				preferences.genres
					.map((genre) =>
						preferences.mediaType ===
						"tv"
							? tvGenreIds[
								genre
								]
							: genreIds[
								genre
								],
					)
					.filter(
						(
							id,
						): id is number =>
							id !== undefined,
					);

			if (
				selectedGenreIds.length >
				0
			) {
				params.set(
					"with_genres",
					selectedGenreIds.join(
						"|",
					),
				);
			}

			if (
				preferences.era &&
				eraRanges[
					preferences.era
					]
			) {
				const [
					startYear,
					endYear,
				] =
					eraRanges[
						preferences.era
						];

				const dateField =
					preferences.mediaType ===
					"tv"
						? "first_air_date"
						: "primary_release_date";

				params.set(
					`${dateField}.gte`,
					`${startYear}-01-01`,
				);

				params.set(
					`${dateField}.lte`,
					`${endYear}-12-31`,
				);
			}

			if (
				preferences.acclaim ===
				"Highly rated by audiences"
			) {
				params.set(
					"sort_by",
					"vote_average.desc",
				);

				params.set(
					"vote_count.gte",
					"100",
				);
			} else if (
				preferences.acclaim ===
				"Award-winning or critically acclaimed"
			) {
				params.set(
					"sort_by",
					"vote_average.desc",
				);

				params.set(
					"vote_count.gte",
					"250",
				);
			} else if (
				preferences.acclaim ===
				"Popular mainstream movies"
			) {
				params.set(
					"sort_by",
					"popularity.desc",
				);
			} else if (
				preferences.acclaim ===
				"Hidden gems and underrated movies"
			) {
				params.set(
					"sort_by",
					"vote_average.desc",
				);

				params.set(
					"vote_count.gte",
					"20",
				);

				params.set(
					"vote_count.lte",
					"500",
				);
			}

			if (
				preferences.mediaType ===
				"movie" &&
				preferences.runtime ===
				"Under 90 minutes"
			) {
				params.set(
					"with_runtime.lte",
					"89",
				);
			} else if (
				preferences.mediaType ===
				"movie" &&
				preferences.runtime ===
				"90–120 minutes"
			) {
				params.set(
					"with_runtime.gte",
					"90",
				);

				params.set(
					"with_runtime.lte",
					"120",
				);
			} else if (
				preferences.mediaType ===
				"movie" &&
				preferences.runtime ===
				"2–2.5 hours"
			) {
				params.set(
					"with_runtime.gte",
					"121",
				);

				params.set(
					"with_runtime.lte",
					"150",
				);
			} else if (
				preferences.mediaType ===
				"movie" &&
				preferences.runtime ===
				"Over 2.5 hours"
			) {
				params.set(
					"with_runtime.gte",
					"151",
				);
			}

			if (
				preferences.mediaType ===
				"tv" &&
				preferences.runtime
			) {
				if (
					preferences.runtime ===
					"Under 90 minutes"
				) {
					params.set(
						"with_runtime.lte",
						"89",
					);
				} else if (
					preferences.runtime ===
					"90–120 minutes"
				) {
					params.set(
						"with_runtime.gte",
						"90",
					);

					params.set(
						"with_runtime.lte",
						"120",
					);
				} else if (
					preferences.runtime ===
					"2–2.5 hours"
				) {
					params.set(
						"with_runtime.gte",
						"121",
					);

					params.set(
						"with_runtime.lte",
						"150",
					);
				} else if (
					preferences.runtime ===
					"Over 2.5 hours"
				) {
					params.set(
						"with_runtime.gte",
						"151",
					);
				}
			}

			if (
				preferences.origin &&
				originCodes[
					preferences.origin
					]
			) {
				params.set(
					"with_origin_country",
					originCodes[
						preferences.origin
						],
				);
			}

			/* ------------------------------------------------------------------ */
			/* Movie actor filtering                                              */
			/* ------------------------------------------------------------------ */

			if (
				preferences.mediaType ===
				"movie" &&
				preferences.actors.length >
				0
			) {
				const resolvedActorIds =
					await Promise.all(
						preferences.actors.map(
							(actor) =>
								resolveActorId(
									actor,
								),
						),
					);

				const unresolvedActors =
					preferences.actors.filter(
						(
							_actor,
							index,
						) =>
							resolvedActorIds[
								index
								] === null,
					);

				if (
					unresolvedActors.length >
					0
				) {
					return res
						.status(422)
						.json({
							error:
								`Could not find actor or actress: ${unresolvedActors.join(", ")}. Check the spelling and try again.`,
						});
				}

				const castIds =
					resolvedActorIds.filter(
						(
							id,
						): id is number =>
							id !== null,
					);

				if (
					castIds.length > 0
				) {
					/*
					 * TMDb comma = AND
					 * TMDb pipe = OR
					 */
					params.set(
						"with_cast",
						castIds.join(","),
					);
				}
			}

			/* ------------------------------------------------------------------ */
			/* TMDb Discover request                                               */
			/* ------------------------------------------------------------------ */

			const response =
				await fetch(
					`https://api.themoviedb.org/3/discover/${preferences.mediaType}?${params.toString()}`,
					{
						signal:
							AbortSignal.timeout(
								TMDB_REQUEST_TIMEOUT_MS,
							),
					},
				);

			if (!response.ok) {
				console.error(
					"TMDb request failed:",
					response.status,
				);

				return res
					.status(502)
					.json({
						error:
							`The ${preferences.mediaType === "tv" ? "TV" : "movie"} service could not complete the request`,
					});
			}

			const data =
				(await response.json()) as {
					results?: TMDbMedia[];
					page?: number;
					total_pages?: number;
					total_results?: number;
				};

			const recommendations =
				(data.results ?? [])
					.map((item) => ({
						id: item.id,

						title:
							preferences.mediaType ===
							"tv"
								? item.name ??
								"Untitled series"
								: item.title ??
								"Untitled",

						overview:
						item.overview,

						posterUrl:
							item.poster_path
								? `https://image.tmdb.org/t/p/w500${item.poster_path}`
								: null,

						backdropUrl:
							item.backdrop_path
								? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
								: null,

						releaseDate:
							preferences.mediaType ===
							"tv"
								? item.first_air_date ??
								""
								: item.release_date ??
								"",

						rating:
						item.vote_average,

						voteCount:
						item.vote_count,

						genreIds:
						item.genre_ids,
					}));

			return res.json({
				results:
				recommendations,

				page:
					data.page ??
					preferences.page,

				totalPages:
					Math.min(
						data.total_pages ??
						1,
						500,
					),

				totalResults:
					data.total_results ??
					recommendations.length,
			});
		} catch (error) {
			console.error(
				"Recommendation request error:",
				error,
			);

			return res
				.status(502)
				.json({
					error:
						`Unable to connect to the ${preferences.mediaType === "tv" ? "TV" : "movie"} service`,
				});
		}
	},
);

/* -------------------------------------------------------------------------- */
/* Cloudflare Workers / Express adapter                                       */
/* -------------------------------------------------------------------------- */

app.listen(PORT);

export default httpServerHandler({
	port: PORT,
});
