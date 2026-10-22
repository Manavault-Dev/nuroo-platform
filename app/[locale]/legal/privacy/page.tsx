import { redirect } from 'next/navigation'

type Props = { params: Promise<{ locale: string }> }

/** /legal/privacy → /{locale}/privacy (canonical privacy policy page) */
export default async function LegalPrivacyRedirect(props: Props) {
  const params = await props.params
  redirect(`/${params.locale}/privacy`)
}
