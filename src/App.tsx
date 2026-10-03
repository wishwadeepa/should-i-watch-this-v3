
import { useState } from 'react'
import './App.css'

type Answers = {
  mood: string
  era: string
  acclaim: string
  styles: string[]
  origin: string
  runtime: string
  pacing: string
  actors: string[]
}

type Movie = {
  id: number
  title: string
  overview: string
  posterUrl: string | null
  backdropUrl: string | null
  releaseDate: string
  rating: number
  voteCount: number
  genreIds: number[]
}

type Page = 'landing' | 'genres' | 'questionnaire' | 'result'
type RecommendationMode = 'genres' | 'personalized'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

const initialAnswers: Answers = {
  mood: '',
  era: '',
  acclaim: '',
  styles: [],
  origin: '',
  runtime: '',
  pacing: '',
  actors: [],
}

const questions = [
  'What kind of experience are you looking for?',
  'What era of movies do you prefer?',
  'What kind of recognition should the movie have?',
  'What style of movie are you in the mood for?',
  'Where would you like the movie to come from?',
  'How long should the movie be?',
  'Any actor or actress you would like to see?',
]

const options = {
  mood: [
    'Uplifting and feel-good',
    'Dark and intense',
    'Emotional and thought-provoking',
    'Relaxing and light-hearted',
    'Mysterious and suspenseful',
    'Unusual and unpredictable',
  ],
  era: [
    'Classic cinema (before 1970)',
    '1970–1989',
    '1990–2004',
    '2005–2014',
    '2015 onwards',
  ],
  acclaim: [
    'Award-winning or critically acclaimed',
    'Highly rated by audiences',
    'Popular mainstream movies',
    'Hidden gems and underrated movies',
  ],
  styles: [
    'Action',
    'Adventure',
    'Science fiction',
    'Fantasy',
    'Mystery',
    'Thriller',
    'Romance',
    'Drama',
    'Comedy',
    'Horror',
    'Animation',
    'Documentary',
  ],
  origin: [
    'Hollywood / English-language',
    'Indian cinema',
    'Sri Lankan cinema',
    'Korean cinema',
    'Japanese cinema',
    'European cinema',
    'Anywhere in the world',
  ],
  runtime: [
    'Under 90 minutes',
    '90–120 minutes',
    '2–2.5 hours',
    'Over 2.5 hours',
  ],
  pacing: ['Fast-paced', 'Balanced', 'Slow-burn'],
}

const genreChoices = options.styles


function Option({
                  label,
                  selected,
                  onClick,
                  genreWave = false,
                }: {
  label: string
  selected: boolean
  onClick: () => void
  genreWave?: boolean
}) {
  const [wave, setWave] = useState({ x: 0, y: 0, id: 0 })

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (genreWave) {
      const rect = event.currentTarget.getBoundingClientRect()
      setWave({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        id: wave.id + 1,
      })
    }
    onClick()
  }

  return (
      <button
          type="button"
          className={`option ${selected ? 'selected' : ''} ${genreWave ? 'genre-wave-option' : ''}`}
          aria-pressed={selected}
          onClick={handleClick}
          style={{
            '--wave-x': `${wave.x}px`,
            '--wave-y': `${wave.y}px`,
          } as React.CSSProperties}
      >
        {genreWave && (
            <span key={wave.id} className="genre-wave-ripple" />
        )}
        <span className="option-label">{label}</span>
        {!genreWave && (
            <span className="option-check">{selected ? '✓' : ''}</span>
        )}
      </button>
  )
}


function App() {
  const [page, setPage] = useState<Page>('landing')
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Answers>(initialAnswers)
  const [actorInput, setActorInput] = useState('')

  const [recommendationMode, setRecommendationMode] =
      useState<RecommendationMode>('genres')
  const [movies, setMovies] = useState<Movie[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const toggleGenre = (genre: string) => {
    setSelectedGenres((previous) =>
        previous.includes(genre)
            ? previous.filter((item) => item !== genre)
            : [...previous, genre],
    )
  }

  const openQuestionnaire = () => {
    setAnswers((previous) => ({
      ...previous,
      styles: selectedGenres.length
          ? [...selectedGenres]
          : previous.styles,
    }))
    setStep(0)
    setRecommendationMode('personalized')
    setPage('questionnaire')
  }

  const updateAnswer = (
      key: 'mood' | 'era' | 'acclaim' | 'origin' | 'runtime' | 'pacing',
      value: string,
  ) => {
    setAnswers((previous) => ({ ...previous, [key]: value }))
  }

  const toggleStyle = (style: string) => {
    setAnswers((previous) => ({
      ...previous,
      styles: previous.styles.includes(style)
          ? previous.styles.filter((item) => item !== style)
          : [...previous.styles, style],
    }))
  }

  const addActor = () => {
    const name = actorInput.trim()
    if (!name || answers.actors.includes(name)) return

    setAnswers((previous) => ({
      ...previous,
      actors: [...previous.actors, name],
    }))
    setActorInput('')
  }

  const removeActor = (name: string) => {
    setAnswers((previous) => ({
      ...previous,
      actors: previous.actors.filter((actor) => actor !== name),
    }))
  }

  const getRequestBody = (
      mode: RecommendationMode,
      answersOverride: Answers = answers,
  ) =>
      mode === 'genres'
          ? {
            mode,
            genres: selectedGenres,
          }
          : {
            mode,
            genres: answersOverride.styles,
            mood: answersOverride.mood,
            era: answersOverride.era,
            acclaim: answersOverride.acclaim,
            origin: answersOverride.origin,
            runtime: answersOverride.runtime,
            pacing: answersOverride.pacing,
            actors: answersOverride.actors,
          }

  const startSearch = async (
      mode: RecommendationMode,
      answersOverride: Answers = answers,
  ) => {
    setRecommendationMode(mode)
    setPage('result')
    setLoading(true)
    setLoadingMore(false)
    setError('')
    setMovies([])
    setPageNumber(1)
    setTotalPages(1)

    try {
      const response = await fetch(
          `${API_URL}/api/recommendations`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...getRequestBody(mode, answersOverride),
              page: 1,
            }),
          },
      )

      const data = (await response.json()) as {
        results?: Movie[]
        page?: number
        totalPages?: number
        error?: string
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to find movies.')
      }

      setMovies(data.results ?? [])
      setPageNumber(data.page ?? 1)
      setTotalPages(data.totalPages ?? 1)
    } catch (err) {
      setError(
          err instanceof Error
              ? err.message
              : 'Something went wrong. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  const loadMore = async () => {
    if (loadingMore || loading || pageNumber >= totalPages) return

    const nextPage = pageNumber + 1
    setLoadingMore(true)
    setError('')

    try {
      const response = await fetch(
          `${API_URL}/api/recommendations`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...getRequestBody(recommendationMode),
              page: nextPage,
            }),
          },
      )

      const data = (await response.json()) as {
        results?: Movie[]
        page?: number
        totalPages?: number
        error?: string
      }

      if (!response.ok) {
        throw new Error(data.error || 'Could not load more movies.')
      }

      setMovies((previous) => {
        const existingIds = new Set(previous.map((movie) => movie.id))
        const newMovies = (data.results ?? []).filter(
            (movie) => !existingIds.has(movie.id),
        )
        return [...previous, ...newMovies]
      })

      setPageNumber(data.page ?? nextPage)
      setTotalPages(data.totalPages ?? totalPages)
    } catch (err) {
      setError(
          err instanceof Error
              ? err.message
              : 'Could not load more movies.',
      )
    } finally {
      setLoadingMore(false)
    }
  }

  const startGenreSearch = () => startSearch('genres')
  const startPersonalizedSearch = () => startSearch('personalized')

  const next = () => {
    if (step === questions.length - 1) {
      startPersonalizedSearch()
    } else {
      setStep((previous) => previous + 1)
    }
  }

  const back = () => {
    if (step === 0) {
      setPage('genres')
    } else {
      setStep((previous) => Math.max(0, previous - 1))
    }
  }

  const skip = () => {
    if (step === 0) {
      updateAnswer('mood', '')
    } else if (step === 1) {
      updateAnswer('era', '')
    } else if (step === 2) {
      updateAnswer('acclaim', '')
    } else if (step === 3) {
      setAnswers((previous) => ({ ...previous, styles: [] }))
    } else if (step === 4) {
      updateAnswer('origin', '')
    } else if (step === 5) {
      setAnswers((previous) => ({
        ...previous,
        runtime: '',
        pacing: '',
      }))
    } else if (step === 6) {
      const answersWithoutActors = { ...answers, actors: [] }
      setAnswers(answersWithoutActors)
      startSearch('personalized', answersWithoutActors)
      return
    }

    next()
  }

  const restart = () => {
    setPage('landing')
    setStep(0)
    setAnswers(initialAnswers)
    setSelectedGenres([])
    setActorInput('')
    setRecommendationMode('genres')
    setMovies([])
    setError('')
    setLoading(false)
    setLoadingMore(false)
    setPageNumber(1)
    setTotalPages(1)
  }

  const scalarKeys = [
    'mood',
    'era',
    'acclaim',
    '',
    'origin',
    'runtime',
  ] as const

  const scalarKey = scalarKeys[step]
  const selectedValue = scalarKey ? answers[scalarKey] : ''

  const isSelected = (value: string) =>
      step === 3
          ? answers.styles.includes(value)
          : selectedValue === value

  const choose = (value: string) => {
    if (step === 3) {
      toggleStyle(value)
    } else if (scalarKey) {
      updateAnswer(scalarKey, value)
    }
  }

  const renderOptions = (items: string[]) => (
      <div className="options-grid">
        {items.map((item) => (
            <Option
                key={item}
                label={item}
                selected={isSelected(item)}
                onClick={() => choose(item)}
            />
        ))}
      </div>
  )

  if (page === 'landing') {
    return (
        <main className="app">
          <section className="flow-panel landing-panel">
            <header className="app-header">
              <span className="eyebrow">YOUR PERSONAL MOVIE DISCOVERY</span>
              <h1>Should I Watch This?</h1>
            </header>

            <div className="flow-copy">
              <h2>Find your next movie.</h2>
              <p className="question-hint">
                A movie for your mood, your taste, or a little surprise.
              </p>
            </div>

            <button
                type="button"
                className="next-button flow-primary"
                onClick={() => setPage('genres')}
            >
              Get started
            </button>
          </section>
        </main>
    )
  }

  if (page === 'genres') {
    return (
        <main className="app">
          <section className="flow-panel genre-panel">
            <header className="app-header">
              <span className="eyebrow">YOUR PERSONAL MOVIE DISCOVERY</span>
              <h1>Should I Watch This?</h1>
            </header>

            <div className="flow-copy">
              <span className="step-label">LET’S START WITH A GENRE</span>
              <h2>What do you feel like watching?</h2>
              <p className="question-hint">
                Choose one or more genres, or let us personalize your picks.
              </p>
            </div>

            <div className="genre-grid">

              {genreChoices.map((genre) => (
                  <Option
                      key={genre}
                      label={genre}
                      selected={selectedGenres.includes(genre)}
                      onClick={() => toggleGenre(genre)}
                      genreWave
                  />
              ))}

            </div>

            <div className="genre-actions">
              <button
                  type="button"
                  className="back-button"
                  onClick={() => setPage('landing')}
              >
                Back
              </button>

              <button
                  type="button"
                  className="next-button"
                  onClick={startGenreSearch}
              >
                Find a movie
              </button>
            </div>

            <button
                type="button"
                className="questionnaire-entry"
                onClick={openQuestionnaire}
            >
              Or let us choose for you
            </button>
          </section>
        </main>
    )
  }

  if (page === 'result') {
    return (
        <main className="app">
          <section className="flow-panel results-panel">
            <header className="app-header">
              <span className="eyebrow">YOUR RECOMMENDATIONS</span>
              <h1>Movies for you</h1>
            </header>


            <div className="flow-copy">
              <p className="question-hint">
                {loading
                    ? 'Finding movies that match your preferences...'
                    : error
                        ? 'We could not retrieve recommendations.'
                        : `${movies.length} movies loaded`}
              </p>
            </div>


            {loading && (
                <div className="result-state" role="status">
                  <span className="loading-spinner" />
                  <p>Finding movies for you…</p>
                </div>
            )}

            {!loading && error && movies.length === 0 && (
                <div className="result-state error-message" role="alert">
                  <h3>Something went wrong</h3>
                  <p>{error}</p>
                  <button
                      type="button"
                      className="next-button"
                      onClick={() => startSearch(recommendationMode)}
                  >
                    Try again
                  </button>
                </div>
            )}

            {!loading && !error && movies.length === 0 && (
                <div className="result-state">
                  <h3>No movies found</h3>
                  <p>
                    Try another genre or change your preferences to discover more
                    movies.
                  </p>
                </div>
            )}

            {movies.length > 0 && (
                <div className="movie-grid">
                  {movies.map((movie) => (

                      <article className="movie-card" key={movie.id}>
                        <div
                            className="movie-ambient"
                            aria-hidden="true"
                            style={{
                              backgroundImage: movie.backdropUrl
                                  ? `url("${movie.backdropUrl}")`
                                  : movie.posterUrl
                                      ? `url("${movie.posterUrl}")`
                                      : 'none',
                            }}
                        />

                        {movie.posterUrl ? (
                            <img
                                className="movie-poster"
                                src={movie.posterUrl}
                                alt={`${movie.title} poster`}
                                loading="lazy"
                            />
                        ) : (
                            <div className="movie-poster-placeholder">
                              <span>No poster available</span>
                            </div>
                        )}

                        <div className="movie-info">
                          <h3>{movie.title}</h3>
                          <p className="movie-meta">
                            {movie.releaseDate?.slice(0, 4) || 'Release year unknown'}
                            {' · '}
                            <span className="movie-rating">
        ★ {Number(movie.rating || 0).toFixed(1)}
      </span>
                          </p>
                          <p className="movie-overview">
                            {movie.overview || 'No description available.'}
                          </p>
                          <a
                              className="movie-link"
                              href={`https://www.themoviedb.org/movie/${movie.id}`}
                              target="_blank"
                              rel="noreferrer"
                          >
                            View movie <span aria-hidden="true">↗</span>
                          </a>
                        </div>
                      </article>

                  ))}
                </div>
            )}

            {error && movies.length > 0 && (
                <p className="load-more-error" role="alert">
                  {error}
                </p>
            )}

            {!loading && !error && pageNumber < totalPages && (
                <div className="load-more-container">
                  <button
                      type="button"
                      className="next-button load-more-button"
                      onClick={loadMore}
                      disabled={loadingMore}
                  >
                    {loadingMore ? 'Loading…' : 'Load more movies'}
                  </button>
                  <p className="question-hint">
                    Showing {movies.length} movies
                  </p>
                </div>
            )}

            {loadingMore && (
                <div className="result-state" role="status">
                  <span className="loading-spinner" />
                  <p>Loading more movies…</p>
                </div>
            )}

            <div className="genre-actions result-actions">
              <button
                  type="button"
                  className="back-button"
                  onClick={() => setPage('genres')}
              >
                Back to genres
              </button>
              <button
                  type="button"
                  className="next-button"
                  onClick={openQuestionnaire}
              >
                Personalize
              </button>
            </div>

            <button
                type="button"
                className="questionnaire-entry"
                onClick={restart}
            >
              Start over
            </button>
          </section>
        </main>
    )
  }

  return (
      <main className="app">
        <section className="questionnaire">
          <button
              type="button"
              className="flow-back"
              onClick={() => setPage('genres')}
          >
            ← Genres
          </button>

          <header className="app-header">
            <span className="eyebrow">YOUR PERSONAL MOVIE DISCOVERY</span>
            <h1>Should I Watch This?</h1>
          </header>

          <div className="progress-info">
          <span>
            QUESTION {step + 1} OF {questions.length}
          </span>
            <span>
            {Math.round(((step + 1) / questions.length) * 100)}%
          </span>
          </div>

          <div
              className="progress-track"
              role="progressbar"
              aria-label="Questionnaire progress"
              aria-valuenow={step + 1}
              aria-valuemin={1}
              aria-valuemax={questions.length}
          >
            <div
                className="progress-fill"
                style={{
                  width: `${((step + 1) / questions.length) * 100}%`,
                }}
            />
          </div>

          <div className="question-content">
            <span className="step-label">STEP {step + 1}</span>
            <h2>{questions[step]}</h2>
            <p className="question-hint">
              {step === 3
                  ? 'Choose as many genres as you like.'
                  : step === 6
                      ? 'Add any performers you enjoy, or skip this step.'
                      : 'Choose one option or skip if you have no preference.'}
            </p>

            {step === 0 && renderOptions(options.mood)}
            {step === 1 && renderOptions(options.era)}
            {step === 2 && renderOptions(options.acclaim)}
            {step === 3 && renderOptions(options.styles)}
            {step === 4 && renderOptions(options.origin)}

            {step === 5 && (
                <>
                  <h3 className="sub-question">Preferred runtime</h3>
                  {renderOptions(options.runtime)}

                  <h3 className="sub-question">Preferred pacing</h3>
                  <div className="options-grid">
                    {options.pacing.map((item) => (
                        <Option
                            key={item}
                            label={item}
                            selected={answers.pacing === item}
                            onClick={() => updateAnswer('pacing', item)}
                        />
                    ))}
                  </div>
                </>
            )}

            {step === 6 && (
                <div className="actor-section">
                  <div className="actor-entry">
                    <input
                        value={actorInput}
                        onChange={(event) => setActorInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            addActor()
                          }
                        }}
                        placeholder="Type an actor or actress name"
                        aria-label="Actor or actress name"
                        maxLength={100}
                    />
                    <button
                        type="button"
                        className="add-button"
                        onClick={addActor}
                        disabled={!actorInput.trim()}
                    >
                      Add
                    </button>
                  </div>

                  {answers.actors.length > 0 && (
                      <div className="actor-chips">
                        {answers.actors.map((actor) => (
                            <button
                                type="button"
                                className="actor-chip"
                                key={actor}
                                onClick={() => removeActor(actor)}
                                aria-label={`Remove ${actor}`}
                            >
                              {actor} <span>×</span>
                            </button>
                        ))}
                      </div>
                  )}

                  <p className="actor-note">
                    Results will only include movies featuring the actors
                    you add, including credited supporting roles.
                  </p>
                </div>
            )}
          </div>

          <footer className="navigation">
            <button
                type="button"
                className="back-button"
                onClick={back}
            >
              Back
            </button>
            <button
                type="button"
                className="skip-button"
                onClick={skip}
            >
              Skip
            </button>
            <button
                type="button"
                className="next-button"
                onClick={next}
            >
              {step === questions.length - 1
                  ? 'Find my movie'
                  : 'Next'}
            </button>
          </footer>
        </section>
      </main>
  )
}



export default App

