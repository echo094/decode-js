export default {
  name: 'reads-as-source',
  protects:
    'A whole small program decodes to the forms its source writes: its statements, its parameters and no call or closure scaffolding.',
  files: {
    cells: [
      {
        sources: [
          'branch-forms',
          'closure-loop',
          'conditional-increment',
          'scale',
        ],
        profile: 'baseline',
        seeds: [1],
      },
    ],
  },
  // A function keeps only the parameters its source declares, and a captured value is read
  // lexically, so no capture cell or wrapped argument remains.
  indicators: {
    'branch-forms': [
      'ifs',
      'switches',
      'labels',
      'parameters',
      'methodCalls',
      'scaffolding',
    ],
    'closure-loop': ['loops', 'parameters', 'copies', 'scaffolding'],
    'conditional-increment': ['ifs', 'parameters', 'copies', 'scaffolding'],
    scale: ['parameters', 'copies', 'scaffolding'],
  },
}
