import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Home } from '../ui/screens/Home';
import { Solo } from '../ui/screens/Solo';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/solo" element={<Solo />} />
        <Route path="/r/:code" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
