import {assign, createMachine} from 'xstate'

// How often the syncing screen asks the node for its peers.
export const PEERS_POLL_MS = 5000

// The syncing screen's peers: `fetchPeers` is asked every PEERS_POLL_MS. A failed call (the node not up yet when the
// app starts) is asked again at the next round and keeps the last list; a node answering null has none.
export function createPeersMachine(fetchPeers) {
  return createMachine({
    context: {
      peers: [],
    },
    initial: 'loading',
    states: {
      loading: {
        invoke: {
          src: () => fetchPeers(),
          onDone: {
            target: 'done',
            actions: [assign({peers: (_, {data}) => data || []})],
          },
          onError: 'done',
        },
      },
      done: {
        after: {
          [PEERS_POLL_MS]: 'loading',
        },
      },
    },
  })
}
