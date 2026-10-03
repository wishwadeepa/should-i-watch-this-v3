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

const initialAnswers: Answers = {
  mood: 'Unusual and unpredictable',
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
                }: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
      <button
          type="button"
          className={`option ${selected ? 'selected' : ''}`}
          aria-pressed={selected}
          onClick={onClick}
      >
        <span>{label}</span>
        <span className="option-check">{selected ? '✓' : ''}</span>
      </button>
  )
}

function App() {
  const [page, setPage] = useState<Page>('landing')
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Answers>(initialAnswers)
  const [actorInput, setActorInput] = useState('')
  const [completed, setCompleted] = useState(false)

  const [recommendationMode, setRecommendationMode] =
      useState<RecommendationMode>('genres')
  const [movies, setMovies] = useState<Movie[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
    setCompleted(false)
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

  const startSearch = async (mode: RecommendationMode) => {
    setRecommendationMode(mode)
    setPage('result')
    setLoading(true)
    setError('')
    setMovies([])

    const requestBody =
        mode === 'genres'
            ? {
              mode,
              genres: selectedGenres,
            }
            : {
              mode,
              genres: answers.styles,
              mood: answers.mood,
              era: answers.era,
              acclaim: answers.acclaim,
              origin: answers.origin,
              runtime: answers.runtime,
              pacing: answers.pacing,
              actors: answers.actors,
            }

    try {
      const response = await fetch(
          'http://localhost:3000/api/recommendations',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          },
      )

      const data = (await response.json()) as {
        results?: Movie[]
        error?: string
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to find movies.')
      }

      setMovies(data.results ?? [])
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

  const startGenreSearch = () => startSearch('genres')
  const startPersonalizedSearch = () => startSearch('personalized')

  const next = () => {
    if (step === questions.length - 1) {
      setCompleted(true)
    } else {
      setStep((previous) => previous + 1)
    }
  }

  const back = () => {
    if (completed) {
      setCompleted(false)
    } else if (step === 0) {
      setPage('genres')
    } else {
      setStep((previous) => Math.max(0, previous - 1))
    }
  }

  const skip = () => {
    if (step === 0) {
      updateAnswer('mood', 'No preference')
    } else if (step === 1) {
      updateAnswer('era', 'No preference')
    } else if (step === 2) {
      updateAnswer('acclaim', 'No preference')
    } else if (step === 3) {
      setAnswers((previous) => ({ ...previous, styles: [] }))
    } else if (step === 4) {
      updateAnswer('origin', 'No preference')
    } else if (step === 5) {
      setAnswers((previous) => ({
        ...previous,
        runtime: 'No preference',
        pacing: 'No preference',
      }))
    } else if (step === 6) {
      setAnswers((previous) => ({ ...previous, actors: [] }))
    }

    next()
  }

  const restart = () => {
    setPage('landing')
    setStep(0)
    setAnswers(initialAnswers)
    setSelectedGenres([])
    setActorInput('')
    setCompleted(false)
    setRecommendationMode('genres')
    setMovies([])
    setError('')
    setLoading(false)
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

  const answerRows: [string, string][] = [
    ['Mood', answers.mood],
    ['Era', answers.era],
    ['Recognition', answers.acclaim],
    ['Genres', answers.styles.join(', ') || 'No preference'],
    ['Origin', answers.origin],
    ['Runtime', answers.runtime],
    ['Pacing', answers.pacing],
    ['Actors / actresses', answers.actors.join(', ') || 'No preference'],
  ]

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
              <span className="eyebrow">YOUR PERSONAL MOVIE DISCOVERY</span>
              <h1>Should I Watch This?</h1>
            </header>

            <div className="flow-copy">
              <span className="step-label">YOUR RECOMMENDATIONS</span>
              <h2>
                {recommendationMode === 'genres'
                    ? selectedGenres.length
                        ? selectedGenres.join(' · ')
                        : 'Movies for you'
                    : 'Your personalized picks'}
              </h2>
              <p className="question-hint">
                {loading
                    ? 'Finding movies that match your preferences…'
                    : error
                        ? 'We could not retrieve recommendations.'
                        : `${movies.length} movies found`}
              </p>
            </div>

            {loading && (
                <div className="result-state" role="status">
                  <span className="loading-spinner" />
                  <p>Finding movies for you…</p>
                </div>
            )}

            {!loading && error && (
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

            {!loading && !error && movies.length > 0 && (
                <div className="movie-grid">
                  {movies.map((movie) => (
                      <article className="movie-card" key={movie.id}>
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
                            {movie.releaseDate?.slice(0, 4) ||
                                'Release year unknown'}
                            <span aria-hidden="true"> · </span>
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

          {!completed ? (
              <>
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
                          Actor-name filtering is not connected yet. You can enter
                          names here and review them with your preferences.
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
                        ? 'Review answers'
                        : 'Next'}
                  </button>
                </footer>
              </>
          ) : (
              <div className="summary">
                <span className="step-label">YOUR PREFERENCES</span>
                <h2>Ready to find a movie?</h2>
                <p className="question-hint">
                  Here’s what we’ll use to find your recommendations.
                </p>

                <div className="summary-list">
                  {answerRows.map(([label, value]) => (
                      <div className="summary-row" key={label}>
                        <span>{label}</span>
                        <strong>{value || 'No preference'}</strong>
                      </div>
                  ))}
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
                      className="next-button"
                      onClick={startPersonalizedSearch}
                  >
                    Find my movie
                  </button>
                </footer>

                <button
                    type="button"
                    className="questionnaire-entry"
                    onClick={restart}
                >
                  Start over
                </button>
              </div>
          )}
        </section>
      </main>
  )
}

export default App