// Large real programs decode end to end. Not proved by a break: behaviour only.
export default {
  name: 'whole-programs',
  protects:
    'Large real programs decode end to end. Not proved by a break: behaviour only.',
  files: {
    'program-sha256': [
      {
        sources: ['program-sha256'],
        profile: 'randomizeOpcodes',
        seeds: [251, 252, 253],
      },
    ],
    'program-cash': [
      {
        sources: ['program-cash'],
        profile: 'randomizeOpcodes',
        seeds: [251, 252, 253],
      },
    ],
  },
}
