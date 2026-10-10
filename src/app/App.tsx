import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Home } from '../ui/screens/Home';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/r/:code" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
