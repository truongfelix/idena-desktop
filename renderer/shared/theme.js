import {theme as defaultTheme} from '@chakra-ui/react'

// The colours that change with the theme (B-166): CSS variables, the light value by default and the dark one under
// prefers-color-scheme: dark, which the main process sets from the user's choice (main/theme.js). The neutral
// names below (surface, gray, brandGray, graphite) point at them, so a page written with those names follows the
// theme; colours used on purpose in both themes (blue, red, green, orange, white text on them) stay fixed.
// Each entry: [light, dark], as "r g b" (rgb(var(--…) / alpha) gives its transparent shades).
const THEMED_COLORS = {
  surface: ['255 255 255', '32 33 36'],
  'gray-50': ['245 246 247', '44 46 50'],
  'gray-100': ['210 212 217', '72 75 81'],
  'gray-300': ['232 234 237', '58 61 66'],
  text: ['83 86 92', '225 227 231'],
  strong: ['17 17 17', '240 240 240'],
  graphite: ['69 72 77', '24 25 28'],
  // Dark boxes with white text (the sidebar, the validation's countdown): the text grey in the light theme.
  panel: ['83 86 92', '24 25 28'],
}

function themedVariables(index) {
  return Object.fromEntries(
    Object.entries(THEMED_COLORS).map(([name, values]) => [
      `--idena-${name}`,
      values[index],
    ])
  )
}

const themed = (name, alpha) =>
  alpha === undefined
    ? `rgb(var(--idena-${name}))`
    : `rgb(var(--idena-${name}) / ${alpha})`

const breakpoints = {
  sm: '30em',
  md: '40em',
  lg: '52em',
  xl: '64em',
}

export const theme = {
  colors: {
    black: '#16161D',
    blue: {
      '010': 'rgb(87 143 255 / 0.1)',
      '012': 'rgb(87 143 255 / 0.12)',
      '020': 'rgb(87 143 255 / 0.2)',
      '025': 'rgb(87 143 255 / 0.25)',
      '030': 'rgb(87 143 255 / 0.3)',
      '032': 'rgb(87 143 255 / 0.32)',
      '090': 'rgb(87 143 255 / 0.9)',
      200: '#578fff',
      300: 'rgba(87, 143, 255, .12)',
      500: 'rgb(87, 143, 255)',
      600: 'rgb(87, 143, 255)',
    },
    // The window's background (cards, dialogs, menus): white in the light theme.
    surface: themed('surface'),
    // A dark box with white text, in both themes (THEMED_COLORS.panel).
    panel: themed('panel'),
    gray: {
      '016': themed('text', 0.16),
      '030': themed('text', 0.3),
      '064': themed('text', 0.64),
      '080': themed('text', 0.8),
      10: 'rgba(255,255,255,0.1)',
      50: themed('gray-50'),
      100: themed('gray-100'),
      200: themed('gray-100'),
      212: themed('gray-100', 0.12),
      300: themed('gray-300'),
      500: themed('text'),
      600: themed('text'),
      800: themed('text'),
      900: themed('strong'),
      980: themed('strong', 0.8),
    },
    red: {
      '010': 'rgb(255 102 102 /0.10)',
      '012': 'rgb(255 102 102 /0.12)',
      '016': 'rgb(255 102 102 /0.16)',
      '020': 'rgb(255 102 102 /0.20)',
      '025': 'rgb(255 102 102 /0.25)',
      '050': 'rgb(255 102 102 /0.50)',
      '090': 'rgb(255 102 102 /0.90)',
      500: 'rgb(255, 102, 102)',
    },
    green: {
      '010': 'rgb(39 217 128 /.1)',
      '020': 'rgb(39 217 128 /.2)',
      '040': 'rgb(39 217 128 /.4)',
      '050': 'rgb(39 217 128 /.5)',
      500: 'rgb(39 217 128)',
    },
    orange: {
      '010': 'rgb(255 163 102 /0.1)',
      '020': 'rgb(255 163 102 /0.2)',
      '040': 'rgb(255 163 102 /0.5)',
      '050': 'rgb(255 163 102 /0.5)',
      500: 'rgb(255, 163, 102)',
    },
    warning: {
      '016': 'rgba(255, 163, 102, 0.16)',
      100: 'rgba(255, 163, 102, 0.2)',
      400: 'rgb(255, 163, 102)',
      500: 'rgb(255, 163, 102)',
    },
    success: {
      '016': 'rgba(39, 217, 128, 0.16)',
      100: 'rgba(39, 217, 128, 0.2)',
      400: 'rgb(39, 217, 128)',
    },
    muted: 'rgb(150, 153, 158)',
    brand: {
      gray: themed('text'),
      blue: 'rgb(87, 143, 255)',
    },
    brandGray: {
      '005': themed('text', 0.05),
      '006': themed('text', 0.06),
      '016': themed('text', 0.16),
      '060': themed('text', 0.6),
      '080': themed('text', 0.8),
      500: themed('text'),
    },
    brandBlue: {
      10: 'rgba(87, 143, 255, 0.12)',
      20: 'rgba(87, 143, 255, 0.24)',
      '025': 'rgba(87, 143, 255, 0.25)',
      50: 'rgba(87, 143, 255, 0.24)',
      100: '#578fff',
      200: '#578fff',
      300: '#447ceb',
      400: '#447ceb',
      500: 'rgb(87, 143, 255)',
      600: '#447ceb',
      700: '#447ceb',
    },
    xblack: {
      '016': 'rgb(0 0 0 /0.16)',
      '080': 'rgb(0 0 0 /0.8)',
    },
    xwhite: {
      '010': 'rgb(255 255 255 /0.10)',
      '016': 'rgb(255 255 255 /0.16)',
      '040': 'rgb(255 255 255 /0.4)',
      '050': 'rgba(255, 255, 255, 0.5)',
      '090': 'rgba(255, 255, 255, 0.9)',
    },
    graphite: {
      500: themed('graphite'),
    },
  },
  styles: {
    global: {
      ':root': themedVariables(0),
      '@media (prefers-color-scheme: dark)': {
        ':root': {...themedVariables(1), colorScheme: 'dark'},
      },
      body: {
        bg: 'surface',
        color: 'gray.800',
      },
    },
  },
  fonts: {
    body: ['Inter', defaultTheme.fonts.body].join(', '),
    heading: ['Inter', defaultTheme.fonts.heading].join(', '),
  },
  fontSizes: {
    sm: '11px',
    md: '13px',
    mdx: '14px',
    base: '16px',
    lg: '18px',
    xl: '28px',
  },
  breakpoints,
  space: {
    '1/2': '2px',
    '3/2': '6px',
  },
  sizes: {
    sm: rem(360),
    mdx: '400px',
    md: rem(480),
  },
  radii: {
    sm: '0.25rem',
    md: rem(6),
    xl: '0.75rem',
  },
  components: {
    Popover: {
      baseStyle: {
        content: {
          bg: 'surface',
        },
      },
    },
    Modal: {
      baseStyle: {
        overlay: {
          bg: 'xblack.080',
        },
        dialog: {
          bg: 'surface',
        },
      },
      sizes: {
        mdx: {
          dialog: {
            maxW: '400px',
          },
        },
        440: {
          dialog: {
            maxW: '440px',
          },
        },
        md: {
          dialog: {
            maxW: '480px',
          },
        },
        416: {
          dialog: {
            maxW: '416px',
          },
        },
        664: {
          dialog: {
            maxW: '664px',
          },
        },
        xl: {
          dialog: {
            maxW: '30%',
          },
        },
      },
    },
    Drawer: {
      baseStyle: {
        overlay: {
          bg: 'xblack.080',
        },
        dialog: {
          bg: 'surface',
        },
        footer: {
          borderTopWidth: 1,
          borderTopColor: 'gray.300',
          py: 3,
          paddingX: 4,
          justify: 'flex-end',
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
        },
      },
    },
    Menu: {
      baseStyle: {
        button: {
          borderRadius: 'md',
          h: 8,
          w: 6,
          _hover: {bg: 'gray.50'},
          _expanded: {bg: 'gray.50'},
        },
        list: {
          bg: 'surface',
          border: 'none',
          borderRadius: 'lg',
          py: 2,
          minW: '145px',
          shadow:
            '0 4px 6px 0 rgba(83, 86, 92, 0.24), 0 0 2px 0 rgba(83, 86, 92, 0.2)',
          '&:focus:not([data-focus-visible-added])': {
            shadow:
              '0 4px 6px 0 rgba(83, 86, 92, 0.24), 0 0 2px 0 rgba(83, 86, 92, 0.2)',
          },
        },
        item: {
          fontWeight: 500,
          px: 3,
          py: '1.5',
          _hover: {bg: 'gray.50'},
          _focus: {bg: 'gray.50'},
        },
        divider: {
          borderColor: 'gray.300',
          borderWidth: 1,
          my: '2',
        },
      },
    },
    Radio: {
      sizes: {
        lg: {
          h: '14',
        },
      },
      variants: {
        bordered: {
          container: {
            borderColor: 'gray.300',
            borderWidth: 1,
            borderRadius: 'md',
            px: '3',
            py: '2',
          },
        },
      },
    },
    Button: {
      baseStyle: {
        fontWeight: 500,
      },
      sizes: {
        md: {
          h: '8',
        },
        mdx: {
          h: '10',
        },
        lg: {
          h: '12',
          px: '3',
          borderRadius: 'lg',
          fontSize: '15px',
          fontWeight: 400,
        },
        lgx: {
          h: '14',
          px: '3',
          borderRadius: '14px',
          fontSize: '20px',
          fontWeight: 500,
        },
      },
      variants: {
        primary: {
          bg: 'blue.500',
          color: 'white',
          borderRadius: 6,
          px: 4,
          _hover: {
            bg: 'rgb(68, 124, 235)',
            _disabled: {
              bg: 'blue.500',
            },
          },
          _active: {
            bg: 'rgb(68, 124, 235)',
          },
        },
        secondary: {
          bg: 'blue.012',
          color: 'blue.500',
          borderRadius: 6,
          px: 4,
          _hover: {
            bg: 'blue.024',
            _disabled: {
              bg: 'gray.100',
            },
          },
          _active: {
            bg: 'blue.024',
          },
          _disabled: {
            bg: 'gray.100',
            color: 'gray.300',
          },
        },
        danger: {
          bg: 'red.500',
          _hover: {
            bg: 'red.500',
            _disabled: {
              bg: 'red.500',
            },
          },
          _focus: {
            ring: 2,
            ringColor: 'red.050',
          },
          _active: {
            bg: 'red.500',
          },
        },
        primaryFlat: {
          bg: 'transparent',
          color: 'brandBlue.500',
          borderRadius: 8,
        },
        secondaryFlat: {
          bg: 'transparent',
          color: 'muted',
          borderRadius: '8',
          _disabled: {
            color: 'gray.300',
          },
        },
        tab: {
          color: 'muted',
          borderRadius: '6',
          h: '8',
          px: '4',
          _hover: {
            bg: 'gray.50',
            color: 'blue.500',
          },
          _selected: {
            bg: 'gray.50',
            color: 'blue.500',
          },
          _active: {
            bg: 'gray.50',
            color: 'blue.500',
          },
        },
      },
    },
    Input: {
      sizes: {
        md: {
          field: {
            h: 8,
            px: 3,
            borderRadius: 'md',
            fontSize: 'md',
          },
        },
        lg: {
          field: {
            h: 12,
            px: 3,
            borderRadius: 'lg',
            fontSize: '15px',
          },
        },
      },
      variants: {
        outline: {
          field: {
            borderColor: 'gray.300',
            _hover: {
              borderColor: 'gray.300',
            },
            _placeholder: {
              color: 'muted',
            },
            _disabled: {
              bg: 'gray.50',
              color: 'muted',
              '-webkit-text-fill-color': '#96999E',
              opacity: 1,
            },
            _readOnly: {
              bg: 'gray.50',
              color: 'muted',
              '-webkit-text-fill-color': '#96999E',
            },
          },
        },
      },
    },
    NumberInput: {
      sizes: {
        md: {
          field: {
            h: 8,
            px: 3,
          },
        },
      },
      variants: {
        outline: {
          field: {
            borderColor: 'gray.300',
            _hover: {
              borderColor: 'gray.300',
            },
            _placeholder: {
              color: 'muted',
            },
            _disabled: {
              bg: 'gray.50',
              color: 'muted',
              '-webkit-text-fill-color': '#96999E',
              opacity: 1,
            },
          },
        },
      },
    },
    Textarea: {
      sizes: {
        md: {
          px: 3,
          py: 2,
          minH: '16',
        },
      },
      variants: {
        outline: {
          borderColor: 'gray.300',
          _hover: {
            borderColor: 'gray.300',
          },
          _placeholder: {
            color: 'muted',
          },
        },
      },
    },
    Select: {
      // Chakra's light mode paints the box and its options white: the surface follows the theme.
      baseStyle: {
        field: {
          bg: 'surface',
          '> option, > optgroup': {
            bg: 'surface',
          },
        },
      },
      sizes: {
        md: {
          field: {
            px: '2',
          },
        },
      },
    },
    FormError: {
      baseStyle: {
        text: {
          fontSize: 'md',
          lineHeight: '4',
        },
        icon: {
          boxSize: '3',
          marginEnd: '1',
        },
      },
    },
    Table: {
      baseStyle: {
        table: {
          fontVariantNumeric: 'normal',
          width: '100%',
        },
      },
      sizes: {
        md: {
          td: {
            px: 3,
            py: 2,
            lineHeight: 'inherit',
          },
        },
      },
    },
    Alert: {
      variants: {
        validation: ({colorScheme}) => ({
          container: {
            bg: `${colorScheme}.500`,
            color: 'white',
            borderRadius: 'lg',
            boxShadow:
              '0 3px 12px 0 rgba(255, 102, 102, 0.1), 0 2px 3px 0 rgba(255, 102, 102, 0.2)',
            px: '4',
            py: '1',
            minH: '42px',
          },
          title: {
            fontSize: 'md',
            fontWeight: 400,
            lineHeight: '5',
            marginEnd: ['2', '6'],
            maxW: ['48', 'none'],
          },
          description: {
            lineHeight: '5',
          },
          icon: {
            flexShrink: 0,
            marginEnd: '3',
            w: '5',
            h: '5',
          },
          spinner: {
            flexShrink: 0,
            marginEnd: '3',
            w: '5',
            h: '5',
          },
        }),
      },
    },
    Form: {
      baseStyle: {
        container: {
          px: 'px',
          pb: 'px',
        },
      },
    },
  },
}

export function rem(value) {
  return `${value / 16}rem`
}
