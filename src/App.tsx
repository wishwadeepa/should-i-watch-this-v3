
import { useEffect, useState } from 'react'
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

type PersonSuggestion = {
  id: number
  name: string
  knownForDepartment?: string
  profileUrl: string | null
}

type RecommendationItem = {
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
type MediaType = 'movie' | 'tv'

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
  const [actorSuggestions, setActorSuggestions] = useState<PersonSuggestion[]>([])
  const [actorSearchLoading, setActorSearchLoading] = useState(false)
  const [actorSearchError, setActorSearchError] = useState('')
  const [activeActorSuggestion, setActiveActorSuggestion] = useState(-1)

  const [recommendationMode, setRecommendationMode] =
      useState<RecommendationMode>('genres')
  const [movies, setMovies] = useState<RecommendationItem[]>([])
  const [mediaType, setMediaType] = useState<MediaType>('movie')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  useEffect(() => {
    const query = actorInput.trim()
    if (page !== 'questionnaire' || step !== 6 || query.length < 2) {
      setActorSuggestions([])
      setActorSearchLoading(false)
      setActorSearchError('')
      setActiveActorSuggestion(-1)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setActorSearchLoading(true)
      setActorSearchError('')
      try {
        const response = await fetch(
            `${API_URL}/api/people/search?query=${encodeURIComponent(query)}`,
            { signal: controller.signal },
        )
        const data = (await response.json()) as { results?: PersonSuggestion[]; error?: string }
        if (!response.ok) throw new Error(data.error || 'Could not search for people.')
        setActorSuggestions((data.results ?? []).filter(
            (person) => !answers.actors.some((actor) => actor.toLocaleLowerCase() === person.name.toLocaleLowerCase()),
        ))
        setActiveActorSuggestion(-1)
      } catch (err) {
        if (!controller.signal.aborted) {
          setActorSuggestions([])
          setActorSearchError(err instanceof Error ? err.message : 'Could not search for people.')
        }
      } finally {
        if (!controller.signal.aborted) setActorSearchLoading(false)
      }
    }, 300)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [actorInput, answers.actors, page, step])

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

  const addActor = (person?: PersonSuggestion) => {
    const name = (person?.name ?? actorInput).trim()
    if (!name || answers.actors.some((actor) => actor.toLocaleLowerCase() === name.toLocaleLowerCase())) return
    setAnswers((previous) => ({ ...previous, actors: [...previous.actors, name] }))
    setActorInput('')
    setActorSuggestions([])
    setActorSearchError('')
    setActiveActorSuggestion(-1)
  }

  const handleActorInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && actorSuggestions.length > 0) {
      event.preventDefault()
      setActiveActorSuggestion((current) => (current + 1) % actorSuggestions.length)
    } else if (event.key === 'ArrowUp' && actorSuggestions.length > 0) {
      event.preventDefault()
      setActiveActorSuggestion((current) => current <= 0 ? actorSuggestions.length - 1 : current - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (activeActorSuggestion >= 0 && actorSuggestions[activeActorSuggestion]) addActor(actorSuggestions[activeActorSuggestion])
      else if (actorSuggestions.length === 1) addActor(actorSuggestions[0])
      else if (actorSuggestions.length === 0 && actorInput.trim()) addActor()
    } else if (event.key === 'Escape') {
      setActorSuggestions([])
      setActiveActorSuggestion(-1)
    }
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
  ) => {
    if (mode === 'genres') {
      return {
        mode: 'genres' as const,
        genres: selectedGenres,
      }
    }

    return {
      mode: 'personalized' as const,
      genres: answersOverride.styles,
      ...(answersOverride.mood.trim() ? { mood: answersOverride.mood.trim() } : {}),
      ...(answersOverride.era.trim() ? { era: answersOverride.era.trim() } : {}),
      ...(answersOverride.acclaim.trim() ? { acclaim: answersOverride.acclaim.trim() } : {}),
      ...(answersOverride.origin.trim() ? { origin: answersOverride.origin.trim() } : {}),
      ...(answersOverride.runtime.trim() ? { runtime: answersOverride.runtime.trim() } : {}),
      ...(answersOverride.pacing.trim() ? { pacing: answersOverride.pacing.trim() } : {}),
      actors: answersOverride.actors,
    }
  }

  const startSearch = async (
      mode: RecommendationMode,
      answersOverride: Answers = answers,
      targetMediaType: MediaType = mediaType,
  ) => {
    setRecommendationMode(mode)
    setMediaType(targetMediaType)
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
              mediaType: targetMediaType,
              page: 1,
            }),
          },
      )

      const data = (await response.json()) as {
        results?: RecommendationItem[]
        page?: number
        totalPages?: number
        error?: string
      }

      if (!response.ok) {
        throw new Error(data.error || `Failed to find ${mediaType === 'movie' ? 'movies' : 'TV series'}.`)
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
              mediaType,
              page: nextPage,
            }),
          },
      )

      const data = (await response.json()) as {
        results?: RecommendationItem[]
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
    setActorSuggestions([])
    setActorSearchLoading(false)
    setActorSearchError('')
    setActiveActorSuggestion(-1)
    setRecommendationMode('genres')
    setMediaType('movie')
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
              <h1>What Should I Watch?</h1>
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
            <div className="flow-copy page-heading">
              <span className="step-label">LET’S START WITH A GENRE</span>
              <h1>What do you feel like watching?</h1>
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
                  disabled={selectedGenres.length === 0 || loading}
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
              <h1>Picked for you</h1>
            </header>

            <div className={`media-switch ${mediaType === 'tv' ? 'is-tv' : 'is-movie'}`} role="group" aria-label="Recommendation type">
              <span className="media-switch-indicator" aria-hidden="true" />
              <button type="button" className={`media-switch-option ${mediaType === 'movie' ? 'active' : ''}`} aria-pressed={mediaType === 'movie'} onClick={() => mediaType !== 'movie' && startSearch(recommendationMode, answers, 'movie')}>Movies</button>
              <button type="button" className={`media-switch-option ${mediaType === 'tv' ? 'active' : ''}`} aria-pressed={mediaType === 'tv'} onClick={() => mediaType !== 'tv' && startSearch(recommendationMode, answers, 'tv')}>TV Series</button>
            </div>

            <div className="flow-copy">
              <p className="question-hint">
                {loading
                    ? `Finding ${mediaType === 'movie' ? 'movies' : 'TV series'} that match your preferences...`
                    : error
                        ? 'We could not retrieve recommendations.'
                        : `${movies.length} ${mediaType === 'movie' ? 'movies' : 'TV series'} loaded`}
              </p>
            </div>


            {loading && (
                <div className="result-state" role="status">
                  <span className="loading-spinner" />
                  <p>Finding {mediaType === 'movie' ? 'movies' : 'TV series'} for you…</p>
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
                  <h3>No {mediaType === 'movie' ? 'movies' : 'TV series'} found</h3>
                  <p>
                    Try another genre or change your preferences to discover more
                    {mediaType === 'movie' ? ' movies.' : ' TV series.'}
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
                              href={`https://www.themoviedb.org/${mediaType === 'movie' ? 'movie' : 'tv'}/${movie.id}`}
                              target="_blank"
                              rel="noreferrer"
                          >
                            View {mediaType === 'movie' ? 'movie' : 'series'} <span aria-hidden="true">↗</span>
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
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                  <p className="question-hint">
                    Showing {movies.length} {mediaType === 'movie' ? 'movies' : 'series'}
                  </p>
                </div>
            )}

            {loadingMore && (
                <div className="result-state" role="status">
                  <span className="loading-spinner" />
                  <p>Loading more recommendations…</p>
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
            <h1>{step === 1 ? `What era of ${mediaType === 'movie' ? 'movies' : 'TV series'} do you prefer?` : step === 5 ? (mediaType === 'movie' ? 'How long should the movie be?' : 'Optional preferences') : questions[step]}</h1>
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
                  {mediaType === 'movie' ? (
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
                  ) : (
                      <p className="question-hint">Runtime and pacing preferences are movie-only for now. You can skip this step.</p>
                  )}
                </>
            )}

            {step === 6 && (
                <div className="actor-section">
                  <div className="actor-autocomplete">
                    <div className="actor-entry">
                      <input
                          value={actorInput}
                          onChange={(event) => { setActorInput(event.target.value); setActorSearchError('') }}
                          onKeyDown={handleActorInputKeyDown}
                          placeholder="Start typing a name…"
                          aria-label="Search actor or actress"
                          aria-autocomplete="list"
                          aria-expanded={actorSuggestions.length > 0}
                          aria-controls="actor-suggestions"
                          aria-activedescendant={activeActorSuggestion >= 0 ? `actor-suggestion-${actorSuggestions[activeActorSuggestion]?.id}` : undefined}
                          maxLength={100}
                      />
                      <button type="button" className="add-button" onClick={() => addActor()}
                              disabled={!actorInput.trim() || actorSuggestions.length > 0}
                              title="Add typed name if no suggestions are shown">Add</button>
                    </div>
                    {actorSearchLoading && <p className="actor-search-status" role="status">Searching TMDb…</p>}
                    {actorSearchError && <p className="actor-search-status actor-search-error" role="status">{actorSearchError}</p>}
                    {!actorSearchLoading && !actorSearchError && actorInput.trim().length >= 2 && actorSuggestions.length === 0 && (
                        <p className="actor-search-status">No matching people found. You can add the name manually.</p>
                    )}
                    {actorSuggestions.length > 0 && (
                        <div className="actor-suggestions" id="actor-suggestions" role="listbox" aria-label="Matching people">
                          {actorSuggestions.slice(0, 3).map((person, index) => (
                              <button type="button" id={`actor-suggestion-${person.id}`}
                                      className={`actor-suggestion ${activeActorSuggestion === index ? 'active' : ''}`}
                                      key={person.id} role="option" aria-selected={activeActorSuggestion === index}
                                      onMouseDown={(event) => event.preventDefault()} onClick={() => addActor(person)}>
                                {person.profileUrl ? <img src={person.profileUrl} alt="" className="actor-suggestion-avatar" loading="lazy" />
                                    : <span className="actor-suggestion-avatar actor-suggestion-placeholder" aria-hidden="true">?</span>}
                                <span className="actor-suggestion-copy"><strong>{person.name}</strong><small>{person.knownForDepartment || 'Performer'}</small></span>
                                <span className="actor-suggestion-add" aria-hidden="true">+</span>
                              </button>
                          ))}
                        </div>
                    )}
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
                    Results will only include {mediaType === 'movie' ? 'movies' : 'TV series'} featuring the actors
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
