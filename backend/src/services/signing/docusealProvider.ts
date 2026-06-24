import { SigningProvider } from './types';

// STUB. Activated only when DOCUSEAL_API_KEY env var is set AND the course is
// configured to use external signing. Phase 1 ships with the in-app provider
// only; this exists so the architecture is ready when the team is.
//
// When implemented, this provider will:
//   1. Create a DocuSeal "submission" via the REST API, pre-filled with the
//      document body text and the user's email.
//   2. Surface the signing URL back to the client (which renders it in an
//      embedded iframe, or redirects there).
//   3. Listen for the DocuSeal webhook on completion, then create the
//      DocumentSignature row with externalProvider="docuseal",
//      externalEnvelopeId=<submission id>, externalAuditUrl=<audit pdf url>.
//
// DocuSeal API key + embedded signing are gated behind their Pro tier
// ($20/user/month at time of writing). Until the team commits to that, leave
// this stub alone and use inAppProvider.

export const docusealProvider: SigningProvider = {
  async sign() {
    throw new Error(
      'DocuSeal signing provider is not implemented in this build. ' +
        'Set up DOCUSEAL_API_KEY and implement docusealProvider.sign() before enabling.',
    );
  },
};
