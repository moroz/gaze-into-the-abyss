// Ends a credit with a full stop unless it already ends in one, as "Potsdam Univ." does.
export const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`)
