
import { createTheme } from '@mui/material/styles'

const theme = createTheme({
    palette: {
        mode: 'dark',
        primary: {
            main: '#D0BCFF',
            light: '#EADDFF',
            dark: '#A98BFA',
            contrastText: '#381E72',
        },
        secondary: {
            main: '#CCC2DC',
            contrastText: '#332D41',
        },
        background: {
            default: '#141218',
            paper: '#211F26',
        },
        text: {
            primary: '#E6E0E9',
            secondary: '#CAC4D0',
        },
        divider: 'rgba(230, 224, 233, 0.12)',
    },
    shape: {
        borderRadius: 24,
    },
    typography: {
        fontFamily: 'Poppins, sans-serif',
        h1: {
            fontWeight: 800,
            letterSpacing: '-0.04em',
        },
        h2: {
            fontWeight: 800,
            letterSpacing: '-0.035em',
        },
        h3: {
            fontWeight: 700,
        },
        button: {
            fontWeight: 700,
            textTransform: 'none',
        },
    },
    components: {
        MuiButton: {
            defaultProps: {
                disableElevation: true,
            },
            styleOverrides: {
                root: {
                    borderRadius: 999,
                    minHeight: 48,
                    padding: '12px 24px',
                    textTransform: 'none',
                    transition: 'all 200ms ease',
                },
            },
        },
        MuiCard: {
            styleOverrides: {
                root: {
                    borderRadius: 28,
                    backgroundImage: 'none',
                },
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                },
            },
        },
    },
})

export default theme
