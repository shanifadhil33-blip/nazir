# Owned sample verification file

`public/.well-known/nazir-verify.txt` is a public domain verification code for Nazir's isolated `qa.safety.proof.nov17@example.test` account. That account connects to the public sample endpoint on this same Nazir deployment. It supports live testing of the API ownership proof without a third party service or domain.

The code is deliberately public. It grants no authentication, database or SDK access. The server binds it to one workspace, HTTPS origin and connection revision. Saving a different connection makes it invalid. Never put an authentication secret or SDK key in this file.
