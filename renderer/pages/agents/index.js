import Layout from '../../shared/components/layout'
import {Page} from '../../shared/components/components'
import {AgentsList} from '../../screens/agents/agents-list'

export default function AgentsPage() {
  return (
    <Layout>
      <Page>
        <AgentsList />
      </Page>
    </Layout>
  )
}
