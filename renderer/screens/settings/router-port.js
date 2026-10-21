/* eslint-disable react/prop-types */
import * as React from 'react'
import {
  Box,
  Radio,
  RadioGroup,
  Stack,
  Text,
  useClipboard,
} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  Tooltip,
} from '../../shared/components/components'
import {InfoIcon} from '../../shared/components/icons'
import {useInterval} from '../../shared/hooks/use-interval'
import {callRpc} from '../../shared/utils/utils'
import {ownPeerId, peerCode} from '../../../main/direct-peers'
import {useEpochState} from '../../shared/providers/epoch-context'
import {useNodeState} from '../../shared/providers/node-context'
import {useSettingsState} from '../../shared/providers/settings-context'
import {PORT_DURATIONS, durationEnd} from '../../../main/router-port'

const routerPort = (command, data) =>
  global.ipcRenderer.invoke('router-port', command, data)

/** An opening's end as the app shows dates elsewhere: the computer's format and time zone. */
function formatEnd(ms) {
  return new Date(ms).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/** When the app's opening for this computer ends: the user's end, else the router's lease; null for none. */
export function openingEnd(found, nowMs) {
  if (found.opening && found.opening.client === found.pcIp)
    return found.opening.endMs
  const lease = found.mapping?.leaseSeconds
  return lease > 0 ? nowMs + lease * 1000 : null
}

/**
 * How long an opening stays with no peer from outside before the row points at this computer's firewall: the
 * first peers came in 10-30 s on the phone, in 4 min on a desktop (2026-10-08). Counted from the opening's last
 * change, as its peers are (the upkeep makes it again once after 5 quiet minutes).
 */
export const QUIET_HINT_MS = 10 * 60 * 1000

/**
 * What the Router port row says for `status` (main/router-port-service.js) at `nowMs`, in which color, which
 * button it offers ('look', 'search-again', 'try-again', 'open', 'close', 'use-port' or none) and, for an opening no peer
 * from outside has used for QUIET_HINT_MS while the node runs (`nodeStarted`), a `hint`. `anchor` is true while the
 * port is open for this computer: the row then says the node can help phones connect (B-129). `t` translates.
 */
export function routerPortView(status, t, nowMs, {nodeStarted = false} = {}) {
  switch (status.state) {
    case 'idle':
      return {
        line: t(
          "The app looks for this network's router only when you ask. Some routers announce themselves only every 15 minutes."
        ),
        color: 'muted',
        action: 'look',
      }
    case 'node-stopped':
      return {line: t('Shown while the node runs.'), color: 'muted'}
    case 'searching': {
      const minutes = Math.floor((nowMs - status.startedMs) / 60000)
      const {heard} = status
      let line
      if (heard) {
        line =
          minutes > 0
            ? t(
                'Looking for the router of this network… {{name}} answered, without port opening (UPnP). Some routers announce themselves only every 15 minutes ({{minutes}} min so far).',
                {name: heard, minutes}
              )
            : t(
                'Looking for the router of this network… {{name}} answered, without port opening (UPnP). Some routers announce themselves only every 15 minutes.',
                {name: heard}
              )
      } else {
        line =
          minutes > 0
            ? t(
                'Looking for the router of this network… Some routers announce themselves only every 15 minutes ({{minutes}} min so far).',
                {minutes}
              )
            : t(
                'Looking for the router of this network… Some routers announce themselves only every 15 minutes.'
              )
      }
      return {line, color: 'muted'}
    }
    case 'not-found':
      return {
        line: status.heard
          ? t(
              "{{name}} offers no port opening (UPnP): it may be turned off in the router's settings",
              {name: status.heard, nsSeparator: '!!'}
            )
          : t('No router with UPnP heard on this network'),
        color: 'muted',
        action: 'search-again',
      }
    case 'failed':
      return {
        line: t('Router: {{message}}', {
          message: status.message,
          nsSeparator: '!!',
        }),
        color: 'red.500',
        action: 'try-again',
      }
    case 'found':
      break
    default:
      return {line: null, color: 'muted'}
  }
  const {name, port, owner, inbound} = status
  if (owner === 'pc') {
    const end = openingEnd(status, nowMs)
    const until = end
      ? t('Open on {{name}} until {{date}}', {name, date: formatEnd(end)})
      : t('Open on {{name}} with no end', {name})
    let incoming = ''
    if (inbound === 1) {
      incoming = ` · ${t('1 peer connected from outside since')}`
    } else if (inbound != null) {
      incoming = ` · ${t('{{count}} peers connected from outside since', {
        count: inbound,
      })}`
    }
    const opening =
      status.opening?.client === status.pcIp ? status.opening : null
    const quietMs = opening ? nowMs - opening.changedAtMs : 0
    const hint =
      nodeStarted && inbound === 0 && quietMs >= QUIET_HINT_MS
        ? t(
            'No node from outside has connected for {{minutes}} min. If this computer has a firewall, it must let in TCP port {{port}}.',
            {minutes: Math.floor(quietMs / 60000), port}
          )
        : null
    return {
      line: until + incoming,
      color: 'muted',
      action: 'close',
      hint,
      anchor: true,
    }
  }
  if (owner === 'pc-before') {
    return {
      line: t(
        "Open on {{name}} for this computer's former address; the app moves it to the new one",
        {name}
      ),
      color: 'muted',
      action: 'close',
    }
  }
  if (owner === 'other') {
    const taken = t(
      'Port {{port}} on {{name}} goes to another device ({{client}})',
      {port, name, client: status.mapping.client}
    )
    if (!status.freePort) return {line: taken, color: 'muted'}
    return {
      line: `${taken}. ${t('Port {{port}} is free there', {
        port: status.freePort,
      })}`,
      color: 'muted',
      action: 'use-port',
    }
  }
  return {line: t('Closed on {{name}}', {name}), color: 'muted', action: 'open'}
}

/**
 * The Router port row of the Advanced settings (main/router-port-service.js), as in the phone app: the search
 * for the router (on the user's click here, by itself on the phone), a found router's state, and the Open and
 * Close buttons; when another device holds the port, "Use port" for a free one (`onUsePort(port)`: the Node port
 * setting, taken at the next start). The main process keeps the opening afterwards.
 */
export function RouterPortSettings({isDisabled, onUsePort}) {
  const {t} = useTranslation()
  const {nodeStarted} = useNodeState()
  const epoch = useEpochState()
  const settings = useSettingsState()

  const [status, setStatus] = React.useState(null)
  const [isBusy, setIsBusy] = React.useState(false)
  const [isChoosing, setIsChoosing] = React.useState(false)
  const [isClosing, setIsClosing] = React.useState(false)

  const run = React.useCallback(async (command, data) => {
    try {
      setStatus(await routerPort(command, data))
    } catch (error) {
      setStatus({state: 'failed', message: error.message || String(error)})
    }
  }, [])

  // The state when the page opens and when the node starts, then every 10 s. The router is looked for only on
  // "Look for the router".
  React.useEffect(() => {
    if (!isDisabled) run('status')
  }, [isDisabled, nodeStarted, run])

  useInterval(
    () => {
      if (!isBusy) run('status')
    },
    isDisabled ? null : 10 * 1000
  )

  const act = async (command, data) => {
    setIsBusy(true)
    try {
      await run(command, data)
    } finally {
      setIsBusy(false)
    }
  }

  if (isDisabled || !status) return null

  const {line, color, action, hint, anchor} = routerPortView(
    status,
    t,
    Date.now(),
    {
      nodeStarted,
    }
  )
  const button = {
    look: () => run('search-again'),
    'search-again': () => run('search-again'),
    'try-again': () => run('status', {retry: true}),
    open: () => setIsChoosing(true),
    close: () => setIsClosing(true),
    'use-port': () => onUsePort(status.freePort),
  }[action]
  const buttonText = {
    look: t('Look for the router'),
    'search-again': t('Search again'),
    'try-again': t('Try again'),
    open: t('Open…'),
    close: t('Close'),
    'use-port': t('Use port {{port}}', {port: status.freePort}),
  }[action]

  return (
    <Stack spacing={1}>
      <Stack isInline spacing={1} align="center">
        <Text fontWeight={500}>{t('Router port')}</Text>
        <Tooltip
          label={`${t(
            "Opens the node's port ({{port}}) on this network's router (UPnP), so that outside Idena nodes can connect to this computer. The router keeps it open until the end you choose, even if the computer leaves this network or the app is closed.",
            {port: status.port ?? settings.ipfsPort}
          )} ${t(
            'Open a port only if you know what it means: the node can then be reached from the internet.',
            {nsSeparator: '!!'}
          )}`}
          placement="top"
          zIndex="tooltip"
        >
          <InfoIcon boxSize={4} color="muted" />
        </Tooltip>
      </Stack>
      <Stack isInline spacing={3} align="center">
        <Text flex={1} color={color}>
          {line}
        </Text>
        {button && (
          <SecondaryButton isDisabled={isBusy} onClick={button}>
            {buttonText}
          </SecondaryButton>
        )}
      </Stack>
      {hint && <Text color="orange.500">{hint}</Text>}
      {anchor && nodeStarted && <HomeAnchor />}
      {status.error && (
        <Text color="red.500">
          {t('Router: {{message}}', {message: status.error, nsSeparator: '!!'})}
        </Text>
      )}
      {isChoosing && (
        <OpenPortDialog
          name={status.name}
          validationMs={Date.parse(epoch?.nextValidation) || null}
          onClose={() => setIsChoosing(false)}
          onOpen={(endMs) => {
            setIsChoosing(false)
            act('open', {endMs})
          }}
        />
      )}
      <Dialog
        isOpen={isClosing}
        onClose={() => setIsClosing(false)}
        title={t('Close the router port?')}
      >
        <DialogBody>
          <Text>
            {t(
              'Outside nodes can no longer connect to this computer. The peers connected at this moment drop within a minute; the node keeps looking for peers itself.'
            )}
          </Text>
        </DialogBody>
        <DialogFooter>
          <SecondaryButton onClick={() => setIsClosing(false)}>
            {t('Cancel')}
          </SecondaryButton>
          <PrimaryButton
            onClick={() => {
              setIsClosing(false)
              act('close')
            }}
          >
            {t('Close the port')}
          </PrimaryButton>
        </DialogFooter>
      </Dialog>
    </Stack>
  )
}

/** How long to open the port for: the durations, "until the validation + 2 h" with its date when known. */
function OpenPortDialog({name, validationMs, onClose, onOpen}) {
  const {t} = useTranslation()
  const [chosen, setChosen] = React.useState(PORT_DURATIONS[0].value)
  const nowMs = Date.now()
  const duration = PORT_DURATIONS.find((it) => it.value === chosen)

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={t("Open the node's port on {{name}}?", {name})}
    >
      <DialogBody>
        <Text mb={2}>
          {t(
            'For how long? The router keeps it until then, also if this computer leaves this network or the app is closed.'
          )}
        </Text>
        <RadioGroup value={chosen} onChange={setChosen}>
          <Stack spacing={1}>
            {PORT_DURATIONS.map((it) => {
              const end = durationEnd(it, nowMs, validationMs)
              return (
                <Radio
                  key={it.value}
                  value={it.value}
                  isDisabled={!end}
                  alignItems="flex-start"
                >
                  <Box mt="-0.5">
                    <Text>{t(it.label)}</Text>
                    <Text color="muted" fontSize="sm">
                      {end
                        ? t('until {{date}}', {date: formatEnd(end)})
                        : t('the validation date is not known yet')}
                    </Text>
                  </Box>
                </Radio>
              )
            })}
          </Stack>
        </RadioGroup>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Cancel')}</SecondaryButton>
        <PrimaryButton
          onClick={() => {
            const end = durationEnd(duration, Date.now(), validationMs)
            if (end) onOpen(end)
          }}
        >
          {t('Open')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * While the router port is open for this computer (B-129): the node can help phones connect, so the row says to keep
 * it running and to share its peer code (Direct peers), with the code to copy. It explains; nothing is sent.
 */
function HomeAnchor() {
  const {t} = useTranslation()
  const settings = useSettingsState()
  const [ownId, setOwnId] = React.useState(null)
  React.useEffect(() => {
    let alive = true
    callRpc('net_ipfsAddress')
      .then((address) => alive && setOwnId(ownPeerId(address)))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  const code = ownId ? peerCode(ownId, settings.ownPeerName) : ''
  const {onCopy, hasCopied} = useClipboard(code)
  return (
    <Stack spacing={1}>
      <Text>
        {t(
          'Your node can now help phones connect: keep it running at home, and share its peer code with your phone and your friends. They add it in Direct peers to connect to it first.',
          {nsSeparator: '|'}
        )}
      </Text>
      {code && (
        <Stack isInline spacing={2} align="center">
          <Text fontFamily="mono" fontSize="sm" wordBreak="break-all">
            {code}
          </Text>
          <SecondaryButton onClick={onCopy}>
            {hasCopied ? t('Copied') : t('Copy')}
          </SecondaryButton>
        </Stack>
      )}
    </Stack>
  )
}
