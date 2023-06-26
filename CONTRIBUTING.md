# Contributing to the Cycle API Spec

🎉 First off, thank you for taking the time to contribute. We'll be fleshing out this guide a bit more as our open source initiatives expand. 

## Code of Conduct

WIP, but don't be a jerk.

## How Can I Contribute?

### Reporting Bugs

If you notice a discrepancy in the spec vs what you are seeing returned from the API, please open an issue and describe what you're seeing, and provide

1. The API call you are making (with any sensitive API keys/creds removed)
2. A sample of the response (again, with any sensitive information scrubbed)

## Your First Code Contribution

If you want to dive in by suggesting a change to the spec, check out some of the open issues and open a PR. Someone from the Cycle team will review it as soon as possible and give feedback or accept the merge. Please try to keep changes limited in scope and tackle only a single issue per PR.

Your code must pass all of the linters/tests applied to this repo in order to receive a review. No code will be merged that does not pass our checks.   

### Branching

Please follow the template of `your-github-username/feature-name` for your branch names. 

## Release Processes

`main` is the current 'state of the world' of this repository. Only use this branch downstream if you're ok with things potentially breaking. Changes land here before being grouped into a release, and may precede a deployment of Cycle's API.

Once every change on `main` has been applied internally by our team to the API, and the API is pushed to production, our team will do a 'release' off of `main`. The latest release should reflect what is currently available on Cycle's API.

### Making hotfix changes to an existing release

In some situations, we may need to make a change to the latest release, but don't want to pull in all the changes from `main` since they may not be available on our API yet. In this case, follow the below procedure:

1. Create new branch off latest release tag
2. Name said branch `your-github-username/hotfix-\*`
3. Make changes to what's currently released
4. Push branch to github
5. Open PR into main
6. Create & tag release when hotfix branch is ready
7. Fix any merge conflicts, then merge hotfix branch into main so it's up to date.
