import {useRouter} from 'next/router'
import Layout from '../../shared/components/layout'
import {Page} from '../../shared/components/components'
import {AgentPage} from '../../screens/agents/agent-page'

export default function AgentViewPage() {
  const {query} = useRouter()
  return (
    <Layout>
      <Page>{typeof query.id === 'string' && <AgentPage id={query.id} />}</Page>
    </Layout>
  )
}
