import { api } from './client'

export const getWeeklyData = (semana?: string) =>
  api.get('/api/reports/weekly', { params: semana ? { semana } : undefined }).then(r => r.data)

export const generateWeeklyPDF = (semana?: string) =>
  api.post('/api/reports/weekly/generate', null, {
    params: semana ? { semana } : undefined,
    responseType: 'blob',
  }).then(r => r.data)

export const getReportHistory = () =>
  api.get('/api/reports/weekly/history').then(r => r.data)
