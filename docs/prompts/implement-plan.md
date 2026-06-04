Implement this plan end to end: <plan-path>.
The plan has been written so that you can work it in parallel using subagents. Work on the currently checked out local branch, not a worktree. You are the orchestrator and accountable to the AC of each task and the overall plan. Don't return until the entire plan is fully complete. The underlying design is here for your reference: <design-path>. DO NOT RETURN return until it's all done. No shortcuts. No hacks. No stubs. Production quality code throughout the whole plan.

When you think that you have finished, launch an independent subagent that uses gpt 5.5 xhigh. They should not inherit your context. They should have completely fresh context. Use this prompt:
"We've just implemented this plan: <plan-path>.
Make sure that the full AC of the plan is met. Additionally, check for any bugs, maintenance smells, or low hanging perf fruit that needs to be corrected. It's ok if the implementation has drifted slightly from the plan, as long as it still satisfies the requirements. Don't make any changes, just report back with your findings. If you have no findings, that is OK."

If they come back with findings, verify and correct their findings and relaunch the prompt fresh. Loop on this until no findings come back. Go! And don't stop until you have full signoff that the plan is complete!
